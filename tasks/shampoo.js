/*
 * grunt-shampoo
 * https://github.com/ludomade/grunt-shampoo
 *
 * Copyright (c) 2015 Ludomade
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
    createHandlerFilter = require('./lib/handler-filters'),
    httpCodes = require('./lib/http-codes'),
    tryHttpDownload = require('./lib/try-http-download');

var ZIP_FOLDER_NAME = "content-backups",
    ZIP_FILE_NAME_PREFIX = "content-dump-";

var DEFAULT_MAX_CONNECTIONS = 8;

module.exports = function( grunt ) {

  grunt.registerMultiTask( "shampoo", "Retrieve content from the Shampoo CMS API on shampoo.io.", function() {

    var thisTask = this,
        handlerFilter = createHandlerFilter(grunt),
        knoxClient = null;

    function mkdirp(dirPath, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = null;
      }
      _mkdirp(dirPath, options,
        handlerFilter.logErrors("Couldn't create " + dirPath, callback)
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
      var remotePaths = { },
          newJson;

      newJson = shampooUtils.transformJson(obj,
        function (value, key, parentObject, keyPath) {
          if (typeof value === "string") {
            var assetPath = getMediaAssetPath(value);

            if (assetPath != null) {
              var localPath = path.join(mediaCwd, assetPath);
              remotePaths[assetPath] = true;

              grunt.log.debug(
                "Rewriting %s\n" +
                "  old: %j\n" +
                "  new: %j\n",
                keyPath.join("."), value, localPath
              );

              return localPath;
            }
          }
          return value;
        }
      );

      return {
        newJson:     newJson,
        remotePaths: Object.keys(remotePaths)
      };
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

      unzipper
        .once("extract", function (log) {
          grunt.log.debug("%s extract log:\n%j", zipPath, log);
          var extractedFiles = log.map(function (extractResult) {
              return extractResult.deflated || extractResult.stored;
            }).filter(function (extractedPath) {
              return Boolean(extractedPath);
            }).map(function (extractedPath) {
              return path.join(options.zipOut, extractedPath);
            });

          if (extractedFiles.length > 0) {
            processJsonFiles(extractedFiles, options, callback);
          } else {
            callback();
          }
        })
        .once("error", function(error) {
          grunt.log.error("Error unzipping file %j: %s", zipPath, error);
          callback();
        });

      unzipper.extract({ path: options.zipOut });
    }

    function generateZipFileName() {
      return ZIP_FILE_NAME_PREFIX + Date.now() + ".zip";
    }

    function requestZip(zipUrl, options, callback) {
      var zipPath = path.join(
        options.zipOut, ZIP_FOLDER_NAME, generateZipFileName());

      mkdirp(path.dirname(zipPath), null, function (mkdirError) {
        if (mkdirError) {
          callback();
          return;
        }

        grunt.verbose.writeln("Downloading zip");
        shampooUtils.downloadToFile(zipUrl, zipPath, handlerFilter.expectHttpOk(zipUrl,
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

    function downloadMediaList(options, mediaAssets, callback) {

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
            downloadMediaItem( mediaAssets.shift(), options.mediaOut, options.replaceMedia, next );
          }
        }
      };

      fillQueue();
    }

    function downloadMediaItem( remotePath, mediaOut, replace, callback ) {
      var localPath = path.join(mediaOut, remotePath);
          
      grunt.log.debug("Verifying %j -> %j", remotePath, localPath);

      if (replace) {
        grunt.log.debug("replaceMedia is true: Unlinking local file");
        fs.unlink(localPath, function (error) {
          if (error) {
            grunt.log.debug("Failed to unlink local file: %s", error);
          }
          downloadWithEtag(remotePath, localPath, null, callback);
        });
      } else {
        shampooUtils.hashFile(localPath, "md5", function (error, hasher) {
          var etag = null;
          if (error) {
            grunt.log.debug("Etag calculation of local file failed: %s", error);
          } else {
            etag = hasher.digest("hex");
          }
          downloadWithEtag(remotePath, localPath, etag, callback);
        });
      }
    }

    function downloadWithEtag(remotePath, localPath, etag, callback) {
      var tryOptions = {
        logError:   grunt.log.error.bind(grunt.log),
        logVerbose: grunt.verbose.writeln.bind(grunt.verbose),
        logDebug:   grunt.log.debug.bind(grunt.log)
      };

      if (etag) {
        tryOptions.etag = etag;
      }

      mkdirp(path.dirname(localPath), function (error) {
        if (error) {
          callback();
        } else {
          tryHttpDownload(
            function (headers, tryCallback) {
              grunt.log.debug("S3 GET %j", remotePath);
              knoxClient.getFile(remotePath, headers, tryCallback);
            },
            localPath,
            tryOptions,
            function (error, response) {
              grunt.log.write("%s ", localPath);
              if (error) {
                grunt.log.error("%j", error);
              } else if (response.statusCode === httpCodes.NOT_MODIFIED) {
                grunt.log.ok("up to date");
              } else {
                grunt.log.ok("downloaded");
              }
              callback();
            }
          );
        }
      });
    }

    function writeJsonFile(out, object) {
      grunt.log.write( out + " ");
      grunt.log.ok( "saved" );
      grunt.file.write(out, JSON.stringify(object, null, '\t'));
    }

    function processJson(jsonContent, outJsonFile, options, callback) {
      var result = getMediaAssets(jsonContent, options.mediaCwd);

      writeJsonFile(outJsonFile, result.newJson);
      if (options.downloadMedia) {
        downloadMediaList(options, result.remotePaths, callback);
      } else {
        callback();
      }
    }


    function requestJson(jsonUrl, options, callback) {
      request(jsonUrl, handlerFilter.expectJsonResponse(jsonUrl,
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

      var apiUrl = shampooApi.createApiUrl(options);
      grunt.verbose.writeln("Url is %j", apiUrl);

      if (shampooApi.isZipQuery(options.query)) {
        grunt.verbose.writeln("Zip job");
        requestZip(apiUrl, options, callback);
      } else {
        grunt.verbose.writeln("JSON job");
        requestJson(apiUrl, options, callback);
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
        downloadMedia: null,
        maxConnections: DEFAULT_MAX_CONNECTIONS,
        replaceMedia: false
      }));

      var messages = [ ];
      var missing = { };
      var required = [ "key", "secret", "domain", "query", "out" ];
      var isOk = true;

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
        isOk = false;
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

      // downloadMedia is now an explicit option, but i've tried to add it in
      // a backwards compatible way. this, however, means its default value
      // can change:
      // - if mediaOut is specified, it defaults to true
      // - if mediaOut is null or undefined, it defaults to false
      //
      // this mimics pre-v0.0.14 behavior that would use the presence of the
      // mediaOut option to decide whether to download media files.
      //
      // this is done so gruntfiles with unspecified mediaOut values don't
      // start suddenly downloading everything to the current directory after
      // upgrading, but it will be best to explicitly set the downloadMedia
      // option
      if (options.downloadMedia == null) {
        options.downloadMedia = options.mediaOut != null;
      }

      // allow temporary override via command line
      // specify --shampoo-no-download
      if (grunt.option("shampoo-no-download")) {
        options.downloadMedia = false;
      }

      if (grunt.option("shampoo-replace-media")) {
        options.replaceMedia = true;
      }

      if (options.replaceMedia !== false && options.replaceMedia !== true) {
        messages.push("replaceMedia must be true or false. Defaulting to false.");
        options.replaceMedia = false;
      }

      if (options.replaceMedia && !options.downloadMedia) {
        messages.push("replaceMedia is true but downloadMedia is false. Media will not be downloaded.");
      }

      if (options.mediaOut == null) {
        options.mediaOut = ".";
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
        ok: isOk
      };
    }


    function main() {
      var optionResult = getOptions();
      var messagesString = optionResult.messages.join("\n");
      var callback = thisTask.async();

      if (optionResult.ok) {
        var options = optionResult.options;
        grunt.log.writeln(messagesString);
        if (options.mediaOut) {
          knoxClient = makeClient(options.aws || { });
        }
        requestFiles(optionResult.options, callback);
      } else {
        grunt.log.error(messagesString);
        callback(false);
      }

    }

    return main();
  });
};
