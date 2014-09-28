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

var client = null;

module.exports = function( grunt ) {

  grunt.registerMultiTask( "shampoo", "Retrieve content from the Shampoo CMS API on shampoo.io.", function() {

    function makeClient( options ) {
      return knox.createClient( _.pick(options, [
        'region', 'endpoint', 'port', 'key', 'secret', 'access', 'bucket', 'secure', 'headers', 'style'
      ]));
    }

    function getMediaAssets( obj, mediaCwd ) {
      
      var toCheck = [ obj ],
        remotePaths = { };

      while (toCheck.length > 0) {
        var thing = toCheck.shift();

        // don't need to type check here, only objects and arrays will iterate,
        // which is what we want
        _.forOwn(thing, function (value, key) {
          if (typeof value === "string") {
            var assetPath = getMediaAssetPath(value);

            if (assetPath != null) {
              // rewrite the property in the JSON with the local path
              thing[key] = path.join(mediaCwd, assetPath);

              // record the remote path relative to its root downloading
              // setting it as an object property means dupes are naturally 
              // eliminated
              remotePaths[assetPath] = true;
            }
          } else {
            toCheck.push(value);
          }
        });
      }

      return Object.keys(remotePaths);
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
          return assetUrl.pathname.charAt(0) === "/" ?
            assetUrl.pathname.slice(1) :
            assetUrl.pathname;
        }
      } catch (error) { } // url.parse failed, so just fall through to return null
      return null;
    }

    function requestJson(url, options, done) {

      request(url, function( error, response, body ) {
        var errorFormatArgs = null,
          jsonContent;
        if (error) {
          errorFormatArgs = [ "Error requesting %j: %s", url, error ];
        } else if (!response) {
          errorFormatArgs = [ "Empty response for %j", url ];
        } else if (response.statusCode !== HTTP_OK) {
          errorFormatArgs = [ "Unexpected response for %j: %s", url, response.statusCode ];
        } else {
          try {
            jsonContent = JSON.parse(body);
          } catch (parseError) {
            errorFormatArgs = [ "Error parsing %j as JSON: %s", url, parseError ];
          }
        }

        if (errorFormatArgs) {
          var errorMessage = util.format.apply(util, errorFormatArgs);
          grunt.log.error(errorMessage);
          return done(errorMessage);
        }

        if( options.out ) {
          if( options.mediaOut ) {

            saveMedia(options, jsonContent, done);

          } else {

            writeJsonFile( options.out, jsonContent );
            done();

          }
        }

        // TODO: check, do we call done if we fall through to here?
      });

    }

    function generateZipFileName() {
      return ZIP_FILE_NAME_PREFIX + Date.now() + ".zip";
    }

    function requestZip(url, options, done) {

      var zipPath = path.join(
        options.zipOut, ZIP_FOLDER_NAME, generateZipFileName());

      logMkdirp(path.dirname(zipPath), null, function (mkdirError) {
        if (mkdirError) {
          done(false);
          return;
        }

        request(url, function(error, response, body) {

          // TODO: handle bads

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

        }).pipe(fs.createWriteStream(zipPath));

      });

    }

    function saveMedia(options, body, done) {

      var mediaAssets = getMediaAssets( body, options.mediaCwd );

      client = makeClient( options.aws );

      var loadCounter = 0;
      var next = function() {
        loadCounter++;
        if( loadCounter === mediaAssets.length ) {
          writeJsonFile( options.out, body );
          done();
        }
      };

      for( var key in mediaAssets ) {
          verifyDownload( mediaAssets[key], options.mediaOut, next );
      }

    }

    function verifyDownload( dest, mediaOut, doneCallback ) {

      var relativeToBucket = dest;
      dest = mediaOut + dest;

      var localHash = null;
      var destDir = path.dirname(dest);

      fs.readFile( dest, function ( err, data ) {
        if (!err) {
          localHash = crypto.createHash('md5').update(data).digest('hex');
        }

        fs.exists(destDir, function(dirExists) {
          if (dirExists) {
            downloadFile(dest, relativeToBucket, localHash, doneCallback);
          } else {
            mkdirp(destDir, null, function(err){
              if (err) {
                grunt.log.error("Error creating directory %j: %s", destDir, err);
              } else {
                downloadFile(dest, relativeToBucket, localHash, doneCallback);
              }
            });
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

    function downloadFile(dest, src, etag, doneCallback) {
      var requestHeaders = { };

      if (etag) {
        requestHeaders["If-None-Match"] = etag;
      }

      client.getFile(src, requestHeaders, function (err, res) {
        var stop = false;

        if (err) {
          grunt.log.error("Error requesting %j: %s", src, err);
          stop = true;
        } else if (!res) {
          grunt.log.error("Error requesting %j", src);
          stop = true;
        } else if (res.statusCode === HTTP_NOT_MODIFIED) {
          grunt.log.writeln("%s >> up to date", dest);
          stop = true;
        } else if (res.statusCode !== HTTP_OK) {
          grunt.log.error("Unexpected response for %j: %s", url, res.statusCode);
          stop = true;
        }

        if (stop) {
          doneCallback();
          return;
        }

        var file = fs.createWriteStream(dest);
        file.on("error", function(e) {
          grunt.log.error("Error writing to %j: %s", dest, e);
          doneCallback();
        });

        res
          .on('error', function (err) {
            grunt.log.error("Error reading %j: %s", src, err);
            doneCallback();
          })
          .on('end', function () {
            grunt.log.write( dest + " " );
            grunt.log.ok( "downloaded" );
            doneCallback();
          });

        res.pipe(file);
      });

    }

    function requestFiles(options, gruntCallback) {
      grunt.log.subhead( "Retrieving files..." );
      var url = createApiUrl(options, createRequestId());
      if (isZipQuery(options.query)) {
        requestZip(url, options, gruntCallback);
      } else {
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
      var options = rc("shampoo", this.options({
        api: 1,
        query: "dump/json/single-file",
        out: "data/content.json",
        mediaOut: null,
        mediaCwd: null
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

    function logMkdirp(path, options, callback) {
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

    function main() {
      var optionResult = getOptions();
      if (!optionResult.ok) {
        grunt.log.error(optionResult.messages.join("\n"));
        return false;
      }
      
      requestFiles(optionResult.options, this.async());
    }

    return main();
  });
};
