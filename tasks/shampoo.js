/*
 * grunt-shampoo
 * https://github.com/soapcreative/grunt-shampoo
 *
 * Copyright (c) 2014 Soap Creative
 * Licensed under the MIT license.
 */

'use strict';

var request = require("request"),
    fs = require("fs"),
    knox = require("knox"),
    rc = require('rc'),
    DecompressZip = require('decompress-zip'),
    fs = require('fs'),
    path = require('path'),
    util = require('util'),
    url = require('url'),
    _mkdirp = require('mkdirp'),
    _ = require('lodash'),

    shampooApi = require('./lib/shampoo-api'),
    shampooUtils = require('./lib/shampoo-utils'),
    createHandlerFilter = require('./lib/handler-filters');

var HTTP_NOT_MODIFIED = 304;

var ZIP_FOLDER_NAME = "content-backups",
    ZIP_FILE_NAME_PREFIX = "content-dump-";

var DEFAULT_MAX_CONNECTIONS = 8;

module.exports = function( grunt ) {

  grunt.registerMultiTask( "shampoo", "Retrieve content from the Shampoo CMS API on shampoo.io.", function() {

    var thisTask = this,
        handlerFilter = createHandlerFilter(grunt),
        knoxClient = null;

    function mkdirp(path, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = null;
      }
      _mkdirp(path, options,
        handlerFilter.logErrors("Couldn't create " + path, callback)
      );
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

              // record the remote path relative to its root.
              // setting it as an object property means dupes are naturally
              // eliminated.
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

    function processJsonFiles(localPaths, options, callback) {
      var waiting = 0;

      function fileComplete() {
        if (--waiting <= 0) {
          callback();
        }
      }

      localPaths.forEach(function (localPath) {
        waiting++;
        fs.readFile(localPath, handlerFilter.expectJsonContents(localPath,
          function (error, jsonContent) {
            if (error) {
              fileComplete();
            } else {
              processJson(jsonContent, localPath, options, fileComplete);
            }
          }
        ));
      });
    }

    function processZipFile(zipPath, options, callback) {
      var unzipper = new DecompressZip(zipPath);

      unzipper.on("extract", function (log) {
        grunt.log.debug("%s extract log:\n%j", zipPath, log);
        if (options.mediaOut != null) {
          var extractedFiles = log.map(function (extractResult) {
              return extractResult.deflated || extractResult.stored;
            }).filter(function (path) {
              return Boolean(path);
            }).map(function (path) {
              return path.join(options.zipOut, path);
            });

          if (extractedFiles.length > 0) {
            processJsonFiles(extractedFiles, options, callback);
            return;
          }
        }
        // fell through to here because options.mediaOut was not set,
        // or the zip file contained no usable files
        callback();
      });

      unzipper.on("error", function(error) {
        grunt.log.error("Error unzipping file %j: %s", zipPath, error);
        callback();
      });

      unzipper.extract({ path: options.zipOut });
    }

    function generateZipFileName() {
      return ZIP_FILE_NAME_PREFIX + Date.now() + ".zip";
    }

    function requestZip(url, options, callback) {
      var zipPath = path.join(
        options.zipOut, ZIP_FOLDER_NAME, generateZipFileName());

      mkdirp(path.dirname(zipPath), null, function (mkdirError) {
        if (mkdirError) {
          callback();
          return;
        }

        grunt.verbose.writeln("Downloading zip");
        shampooUtils.downloadToFile(url, zipPath, handlerFilter.expectHttpOk(url,
          function (error) {
            if (error) {
              callback();
            } else {
              processZipFile(zipPath, options, callback);
            }
          }
        ));
      });
    }

    function saveMedia(options, mediaAssets, callback) {

      grunt.log.subhead( "Retrieving files..." );

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
          callback();
        } else {
          while (mediaAssets.length > 0 && loadCounter < options.maxConnections) {
            loadCounter++;
            verifyDownload( mediaAssets.shift(), options.mediaOut, next );
          }
        }
      };

      fillQueue();
    }

    function verifyDownload( remotePath, mediaOut, callback ) {

      var localPath = path.join(mediaOut, remotePath);

      grunt.log.debug("Verifying %j -> %j", remotePath, localPath);

      shampooUtils.hashFile(localPath, "md5", function (error, hasher) {
        var localHash = null;
        if (error) {
          grunt.log.debug("Etag calculation of local file failed: %s", error);
        } else {
          localHash = hasher.digest("hex");
        }

        mkdirp(path.dirname(localPath), function (error) {
          if (error) {
            callback();
          } else {
            downloadFile(remotePath, localPath, localHash, callback);
          }
        });
      });
    }

    function writeJsonFile(out, object) {
      grunt.log.write( out + " ");
      grunt.log.ok( "saved" );
      grunt.file.write(out, JSON.stringify(object, null, '\t'));

    }

    function downloadFile(remotePath, localPath, etag, callback) {
      var requestHeaders = { };

      var debugMessage = util.format("S3 GET %j", remotePath);

      if (etag) {
        debugMessage += util.format(" If-None-Match: %s", etag);
        requestHeaders["If-None-Match"] = etag;
      }

      grunt.log.debug(debugMessage);

      knoxClient.getFile(remotePath, requestHeaders, handlerFilter.expectHttpOk(remotePath,
        function (error, response) {
          if (error) {
            callback();
            return;
          }

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
        }
      ));
    }


    function processJson(jsonContent, outJsonFile, options, callback) {
      var mediaAssets = getMediaAssets(jsonContent, options.mediaCwd);
      if (outJsonFile) {
        writeJsonFile(outJsonFile, jsonContent);
        if (options.mediaOut != null) {
          saveMedia(options, mediaAssets, callback);
          return;
        }
      }
      callback();
    }


    function requestJson(url, options, callback) {
      request(url, handlerFilter.expectJsonResponse(url,
        function (error, response, jsonContent) {
          if (error) {
            callback();
          } else {
            processJson(jsonContent, options.out, options, callback);
          }
        }
      ));
    }


    function requestFiles(options, callback) {
      grunt.log.subhead( "Retrieving content..." );

      var url = shampooApi.createApiUrl(options);
      grunt.verbose.writeln("Url is %j", url);

      if (shampooApi.isZipQuery(options.query)) {
        grunt.verbose.writeln("Zip job");
        requestZip(url, options, callback);
      } else {
        grunt.verbose.writeln("JSON job");
        requestJson(url, options, callback);
      }
    }


    function makeClient(options) {
      return knox.createClient( _.pick(options, [
        'region', 'endpoint', 'port', 'key', 'secret', 'access', 'bucket',
        'secure', 'headers', 'style'
      ]));
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

      if (shampooApi.isZipQuery(options.query)) {
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


    function main() {
      var optionResult = getOptions();
      var messagesString = optionResult.messages.join("\n");
      var callback = thisTask.async();

      if (optionResult.ok) {
        grunt.log.writeln(messagesString);
        requestFiles(optionResult.options, callback);
      } else {
        grunt.log.error(messagesString);
        callback(false);
      }

    }

    return main();
  });
};
