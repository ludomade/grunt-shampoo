/*
 * grunt-shampoo
 * https://github.com/soapcreative/grunt-shampoo
 *
 * Copyright (c) 2014 Soap Creative
 * Licensed under the MIT license.
 */

'use strict';

var request = require("request"),
    sha256 = require("sha256"),
    fs = require("fs"),
    knox = require("knox"),
    crypto = require('crypto'),
    rc = require('rc'),
    DecompressZip = require('decompress-zip'),
    fs = require('fs'),
    path = require('path'),
    util = require('util'),
    url = require('url'),
    querystring = require('querystring'),
    mkdirp = require('mkdirp'),
    _ = require('lodash');

var HTTP_OK = 200,
    HTTP_NOT_MODIFIED = 304;

var ZIP_FOLDER_NAME = "content-backups",
    ZIP_FILE_NAME_PREFIX = "content-dump-";

var DEFAULT_MAX_CONNECTIONS = 8;

module.exports = function( grunt ) {

  grunt.registerMultiTask( "shampoo", "Retrieve content from the Shampoo CMS API on shampoo.io.", function() {

    var thisTask = this;
    var gruntFinishTask = this.async();

    function createPath(path, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = null;
      }
      mkdirp(path, options, function (error, created) {
        if (error) {
          grunt.log.error("Couldn't create %j: %s", path, error);
        }
        callback(error, created);
      });
    }

    function castToArray(thing) {
      if (!thing) {
        return [ ];
      }
      if (Array.isArray(thing)) {
        return thing;
      }
      return [ thing ];
    }

    function formatArgsPrefix(prefix) {
      return prefix ?
        [ "%j: ", prefix ] :
        [ "" ];
    }

    function isResponseOk(error, response, requestName, allowExtraStatusCodes) {
      var allowStatusCodes = [ HTTP_OK ].concat(castToArray(allowExtraStatusCodes)),
        formatArgs = formatArgsPrefix(requestName),
        ok = true;

      if (error) {
        formatArgs[0] += "Request error: %s";
        formatArgs.push(error);
        ok = false;
      } else if (!response) {
        formatArgs[0] += "No response";
        ok = false;
      } else if (allowStatusCodes.indexOf(response.statusCode) < 0) {
        formatArgs[0] += "Unexpected status code: %s";
        formatArgs.push(response.statusCode);
        ok = false;
      }

      if (!ok) {
        grunt.log.error.apply(grunt.log, formatArgs);
      }
      return ok;
    }

    function tryParseJson(text, requestName) {
      try {
        return JSON.parse(text);
      } catch (error) {
        var formatArgs = formatArgsPrefix(requestName);
        formatArgs[0] += "Error parsing JSON: %s";
        formatArgs.push(error);
        grunt.log.error.apply(grunt.log, formatArgs);
        return null;
      }
    }

    function makeClient( options ) {
      return knox.createClient( _.pick(options, [
        'region', 'endpoint', 'port', 'key', 'secret', 'access', 'bucket', 'secure', 'headers', 'style'
      ]));
    }

    function isMediaAssetUrl(assetUrl) {
      // a URL is a media asset URL if its scheme/protocol is http or https,
      // and its hostname is a subdomain of amazonaws.com.
      return Boolean(
        assetUrl &&
        /^https?:$/i .test(assetUrl.protocol) &&
        /\.amazonaws\.com$/i .test(assetUrl.hostname)
      );
    }

    function getMediaAssetPath(assetUrlString) {
      var assetUrl;
      try {
        assetUrl = url.parse(assetUrlString);
        if (isMediaAssetUrl(assetUrl)) {
          var pathname = assetUrl.pathname;
          if (pathname.charAt(0) === "/") {
            pathname = pathname.slice(1);
          }
          // url.parse automatically url-escapes characters, but we need to
          // reverse that for passing to the knox client, as well as for saving
          // locally
          return decodeURI(pathname);
        }
      } catch (error) { } // url.parse failed, so just fall through to return null
      return null;
    }

    function getMediaAssets( obj, mediaCwd ) {
      
      var objQueue = [ obj ],
        prefixQueue = [ "[Root]" ],
        remotePaths = { };

      while (objQueue.length > 0) {
        var thing = objQueue.shift(),
          prefix = prefixQueue.shift();

        // don't need to type check here, only objects and arrays will iterate,
        // which is what we want
        _.forOwn(thing, function (value, key) {
          var keyPath = prefix + "." + key;
          if (typeof value === "string") {
            var assetPath = getMediaAssetPath(value);

            if (assetPath != null) {
              // rewrite the property in the JSON with the local path
              thing[key] = path.join(mediaCwd, assetPath);

              grunt.log.debug(
                "Rewriting %s\n" +
                "  old: %j\n" +
                "  new: %j\n",
                keyPath, value, thing[key]
              );

              // record the remote path relative to its root downloading
              // setting it as an object property means dupes are naturally 
              // eliminated
              remotePaths[assetPath] = true;
            }
          } else {
            objQueue.push(value);
            prefixQueue.push(keyPath);
          }
        });
      }

      return Object.keys(remotePaths);
    }

    function requestJson(url, options) {
      grunt.verbose.writeln("Downloading JSON");

      request(url, function( error, response, text ) {
        var jsonContent;
        if (isResponseOk(error, response, url)) {
          jsonContent = tryParseJson(text, url);
        }

        if (jsonContent && options.out) {
          if( options.mediaOut != null ) {

            saveMedia(options, jsonContent);

          } else {

            writeJsonFile( options.out, jsonContent );
            gruntFinishTask();
            return;

          }
        }

        // we reach here if request failed, json parse failed, or if options.out
        // is not set
        gruntFinishTask();
      });

    }

    function generateZipFileName() {
      return ZIP_FILE_NAME_PREFIX + Date.now() + ".zip";
    }

    function requestZip(url, options) {

      var zipPath = path.join(
        options.zipOut, ZIP_FOLDER_NAME, generateZipFileName());

      createPath(path.dirname(zipPath), null, function (mkdirError) {
        if (mkdirError) {
          gruntFinishTask(false);
          return;
        }

        grunt.verbose.writeln("Downloading zip");
        request(url, function(error, response) {

          if (isResponseOk(error, response, url)) {
            var unzipper = new DecompressZip(zipPath);

            unzipper.on("extract", function (log) {

              grunt.log.debug("%s extract log:\n%j", zipPath, log);

              //on extraction of the zip, check if mediaOut is set, if so, loop through all the unzipped files, and grab down the neccesary media.
              if(options.mediaOut == null) {
                // if not, we're done
                gruntFinishTask();
                return;
              }

              for(var key in log) {
                var unzippedFile = path.join(options.zipOut, log[key].deflated);

                fs.readFile( unzippedFile, function ( error, text ) {
                  if (error) {
                    grunt.log.error("Error reading %j: %s", unzippedFile, error);
                  } else {
                    var jsonContent = tryParseJson(text, unzippedFile);
                    if (jsonContent) {
                      // make a new copy of options, with out set to match
                      // zipOut, as json files get written to options.out
                      var newOptions = _.merge({}, options, { out: unzippedFile });

                      saveMedia(newOptions, jsonContent);
                      return;
                    }
                  }
                });

              }

            });

            unzipper.on("error", function(error) {
              grunt.log.error("Error unzipping file %j: %s", zipPath, error);
              gruntFinishTask(false);
            });

            unzipper.extract({
              path: options.zipOut
            });
          } else {
            gruntFinishTask(false);
          }

        }).pipe(fs.createWriteStream(zipPath));

      });

    }

    function saveMedia(options, jsonContent) {

      var mediaAssets = getMediaAssets( jsonContent, options.mediaCwd );
      var client = makeClient( options.aws );

      grunt.log.debug("Media queue is:");
      mediaAssets.forEach(function (p) {
        grunt.log.debug("  %j", p);
      });

      var loadCounter = 0;
      var next = function() {
        loadCounter--;
        fillQueue();
      };

      var fillQueue = function() {
        if (mediaAssets.length === 0 && loadCounter === 0) {
          writeJsonFile( options.out, jsonContent );
          gruntFinishTask();
        } else {
          while (mediaAssets.length > 0 && loadCounter < options.maxConnections) {
            loadCounter++;
            verifyDownload( client, mediaAssets.shift(), options.mediaOut, next );
          }
        }
      };

      fillQueue();
    }

    function verifyDownload( client, remotePath, mediaOut, callback ) {

      var localPath = path.join(mediaOut, remotePath);
      var localHash = null;

      grunt.log.debug("Verifying %j -> %j", remotePath, localPath);
      fs.readFile( localPath, function ( error, text ) {
        if (error) {
          grunt.log.debug("Etag calculation of local file failed: %s", error);
        } else {
          localHash = crypto.createHash('md5').update(text).digest('hex');
        }

        createPath(path.dirname(localPath), function (error) {
          if (!error) {
            downloadFile(client, remotePath, localPath, localHash, callback);
          }
        });
      });

    }

    function writeJsonFile(out, object) {
      grunt.log.subhead( "Retrieving content..." );
      grunt.log.write( out + " ");
      grunt.log.ok( "saved" );
      grunt.file.write(out, JSON.stringify(object, null, '\t'));

    }

    function downloadFile(client, remotePath, localPath, etag, callback) {
      var requestHeaders = { };

      grunt.log.debug("S3 GET %j", remotePath);

      if (etag) {
        grunt.log.debug("If-None-Match: %s", etag);
        requestHeaders["If-None-Match"] = etag;
      }

      client.getFile(remotePath, requestHeaders, function (error, response) {
        if (isResponseOk(error, response, remotePath, HTTP_NOT_MODIFIED)) {
          if (response.statusCode === HTTP_NOT_MODIFIED) {
            grunt.log.write("%s ", localPath);
            grunt.log.ok( "up to date" );
            callback();
            return;
          }

          var file = fs.createWriteStream(localPath);
          file.on("error", function (error) {
            grunt.log.write("%s ", localPath);
            grunt.log.error("Error writing: %s", error);
            callback();
          });

          response
            .on('error', function (error) {
              grunt.log.write("%s ", localPath);
              grunt.log.error("Error reading %j: %s", remotePath, error);
              callback();
            })
            .on('end', function () {
              grunt.log.write("%s ", localPath);
              grunt.log.ok( "downloaded" );
              callback();
            });

          response.pipe(file);
        } else {
          callback();
        }
      });

    }

    function requestFiles(options) {
      grunt.log.subhead( "Retrieving files..." );
      var url = createApiUrl(options, createRequestId());
      grunt.verbose.writeln("Url is %j", url);

      if (isZipQuery(options.query)) {
        grunt.verbose.writeln("Zip job");
        requestZip(url, options);
      } else {
        grunt.verbose.writeln("JSON job");
        requestJson(url, options);
      }
    }

    function isZipQuery(query) {
      return query.indexOf("dump/zip/") === 0;
    }

    function getOptions() {
      // Mix in default options, .shampoorc file
      var options = rc("shampoo", thisTask.options({
        api: 1,
        query: "dump/json/single-file",
        out: "data/content.json",
        mediaOut: null,
        mediaCwd: null,
        maxConnections: DEFAULT_MAX_CONNECTIONS
      }));

      var messages = [ ];
      var missing = { };
      var required = [ "key", "secret", "domain", "query", "out" ];

      if (isZipQuery(options.query)) {
        required.push("zipOut");
      }

      required.forEach(function (optionName) {
        if (!options[optionName]) {
          missing[optionName] = true;
        }
      });

      var missingArray = Object.keys(missing);
      if (missingArray.length > 0) {
        messages.push("The following required options are not set: " +
          missingArray.join(", "));
      }

      if (missing.key || missing.secret) {
        messages.push("Values for 'key' and 'secret' are found in your Shampoo account under Settings.");
      }

      if (missing.zipOut) {
        messages.push(util.format(
          "The query %j returns a zip file. This requires the 'zipOut' option to be set.",
          options.query
        ));
      }

      if (options.mediaCwd == null) {
        options.mediaCwd = options.mediaOut;
      }

      var parsedMaxConnections = parseInt(options.maxConnections, 10);
      if (isNaN(options.maxConnections)) {
        messages.push(util.format(
          "Invalid value for maxConnections: %j. Assuming default of %d.",
          options.maxConnections, DEFAULT_MAX_CONNECTIONS
        ));
        parsedMaxConnections = DEFAULT_MAX_CONNECTIONS;
      } else if (parsedMaxConnections < 1) {
        messages.push(
          "Value for maxConnections must be 1 or greater. Assuming 1.");
        parsedMaxConnections = 1;
      }

      options.maxConnections = parsedMaxConnections;

      return {
        options: options,
        messages: messages,
        ok: messages.length === 0
      };
    }

    function createRequestId() {
      return Date.now().toString(36) +
        (Math.random() * 9007199254740992).toString(36);
    }

    function createToken(secret, key, requestId) {
      return sha256("" + secret + key + requestId);
    }

    function createApiUrl(options, requestId) {
      var url = [
          options.https ? "https" : "http",
          "://",
          options.domain,
          "/api/v",
          options.api,
          "/",
          options.query
        ].join("");

      var queryParams = _.merge({
          requestId: requestId,
          token: createToken(options.secret, options.key, requestId)
        }, options.params || {});

      return url + "?" + querystring.stringify(queryParams);
    }

    function main() {
      var optionResult = getOptions();
      var messagesString = optionResult.messages.join("\n");

      if (optionResult.ok) {
        grunt.log.writeln(messagesString);
        requestFiles(optionResult.options);
      } else {
        grunt.log.error(messagesString);
        gruntFinishTask(false);
      }
      
    }

    return main();
  });
};
