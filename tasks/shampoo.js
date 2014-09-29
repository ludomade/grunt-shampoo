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

    function responseOk(requestName, error, response, allowExtraStatusCodes) {
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

    function tryParseJson(requestName, text) {
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

              grunt.verbose.writeln(
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

    function requestJson(url, options, done) {
      grunt.verbose.writeln("Downloading JSON");

      request(url, function( error, response, body ) {
        var jsonContent;
        if (responseOk(url, error, response)) {
          jsonContent = tryParseJson(body);
        }

        if (jsonContent && options.out) {
          if( options.mediaOut ) {

            saveMedia(options, jsonContent, done);

          } else {

            writeJsonFile( options.out, jsonContent );
            done();
            return;

          }
        }

        // we reach here if request failed, json parse failed, or if options.out
        // is not set
        done();
      });

    }

    function generateZipFileName() {
      return ZIP_FILE_NAME_PREFIX + Date.now() + ".zip";
    }

    function requestZip(url, options, done) {

      var zipPath = path.join(
        options.zipOut, ZIP_FOLDER_NAME, generateZipFileName());

      createPath(path.dirname(zipPath), null, function (mkdirError) {
        if (mkdirError) {
          done(false);
          return;
        }

        grunt.verbose.writeln("Downloading zip");
        request(url, function(error, response, body) {

          if (responseOk(url, error, response)) {
            var unzipper = new DecompressZip(zipPath);

            unzipper.on("extract", function (log) {

              //on extraction of the zip, check if mediaOut is set, if so, loop through all the unzipped files, and grab down the neccesary media.
              if(options.mediaOut !== "") {

                for(var key in log) {
                  var unzippedFile = options.zipOut + log[key].deflated;

                  fs.readFile( unzippedFile, function ( err, data ) {

                    var body = JSON.parse(data);
                    //override the out to match zipOut, as json files get written to options.out
                    options.out = unzippedFile;
                    saveMedia(options, body, done);

                  });

                }

              } else {

                done();

              }

            });

            unzipper.on("error", function(error) {
              grunt.log.error("An error occurred unzipping the file %j: %s", zipPath, error);
              done(false);
            });

            unzipper.extract({
              path: options.zipOut
            });
          } else {
            done(false);
          }

        }).pipe(fs.createWriteStream(zipPath));

      });

    }

    function saveMedia(options, body, done) {

      var mediaAssets = getMediaAssets( body, options.mediaCwd );
      var client = makeClient( options.aws );

      grunt.verbose.writeln("Media queue is:");
      mediaAssets.forEach(function (p) {
        grunt.verbose.writeln("  %j", p);
      });

      var loadCounter = 0;
      var next = function() {
        loadCounter--;
        fillQueue();
      };

      var fillQueue = function() {
        if (mediaAssets.length === 0 && loadCounter === 0) {
          writeJsonFile( options.out, body );
          done();
        } else {
          while (mediaAssets.length > 0 && loadCounter < options.maxConnections) {
            loadCounter++;
            verifyDownload( client, mediaAssets.shift(), options.mediaOut, next );
          }
        }
      };

      fillQueue();
    }

    function verifyDownload( client, remotePath, mediaOut, doneCallback ) {

      var localPath = path.join(mediaOut, remotePath);
      var localHash = null;

      grunt.verbose.writeln("Verifying %j -> %j", remotePath, localPath);
      fs.readFile( localPath, function ( err, data ) {
        if (err) {
          grunt.verbose.error("Etag calculation of local file failed: %s", err);
        } else {
          localHash = crypto.createHash('md5').update(data).digest('hex');
        }

        createPath(path.dirname(localPath), function (error) {
          if (!error) {
            downloadFile(client, remotePath, localPath, localHash, doneCallback);
          }
        });
      });

    }

    function writeJsonFile(out, body) {
      grunt.log.subhead( "Retrieving content..." );
      grunt.log.write( out + " ");
      grunt.log.ok( "saved" );
      grunt.file.write(out, JSON.stringify(body, null, '\t'));

    }

    function downloadFile(client, src, dest, etag, doneCallback) {
      var requestHeaders = { };

      grunt.verbose.writeln("S3 GET %j", src);

      if (etag) {
        grunt.verbose.writeln("If-None-Match: %s", etag);
        requestHeaders["If-None-Match"] = etag;
      }

      client.getFile(src, requestHeaders, function (err, res) {
        if (responseOk(src, err, res, HTTP_NOT_MODIFIED)) {
          var file = fs.createWriteStream(dest);
          file.on("error", function(e) {
            logError("Error writing: %s", e);
            doneCallback();
          });

          res
            .on('error', function (err) {
              logError("Error reading %j: %s", src, err);
              doneCallback();
            })
            .on('end', function () {
              logOk( "downloaded" );
              doneCallback();
            });

          res.pipe(file);
        } else {
          doneCallback();
        }
      });

    }

    function requestFiles(options, gruntCallback) {
      grunt.log.subhead( "Retrieving files..." );
      var url = createApiUrl(options, createRequestId());
      grunt.verbose.writeln("Url is %j", url);

      if (isZipQuery(options.query)) {
        grunt.verbose.writeln("Zip job");
        requestZip(url, options, gruntCallback);
      } else {
        grunt.verbose.writeln("JSON job");
        requestJson(url, options, gruntCallback);
      }
    }

    function isZipQuery(query) {
      return query.indexOf("dump/zip/") === 0;
    }

    function normalizeDir(path) {
      // TODO: change path string operations to use path lib, and make this
      // function unnecessary
      if (path == null) {
        return null;
      }
      path = String(path);
      if (path === "") {
        return "./";
      }
      if (path.slice(-1) !== "/") {
        return path + "/";
      }
      return path;
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

      options.mediaOut = normalizeDir(options.mediaOut);
      if (options.mediaCwd == null) {
        options.mediaCwd = options.mediaOut;
      } else {
        options.mediaCwd = normalizeDir(options.mediaCwd);
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
      var done = thisTask.async();

      if (optionResult.ok) {
        grunt.log.writeln(messagesString);
        requestFiles(optionResult.options, done);
      } else {
        grunt.log.error(messagesString);
        done(false);
      }
      
    }

    return main();
  });
};
