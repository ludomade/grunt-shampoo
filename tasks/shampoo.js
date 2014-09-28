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
    mkdirp = require('mkdirp');

var HTTP_OK = 200,
    HTTP_NOT_MODIFIED = 304;

var client = null;

module.exports = function( grunt ) {

  grunt.registerMultiTask( "shampoo", "Retrieve content from the Shampoo CMS API on shampoo.io.", function() {

    var _ = grunt.util._;

    function makeClient( options ) {
      return knox.createClient( _.pick(options, [
        'region', 'endpoint', 'port', 'key', 'secret', 'access', 'bucket', 'secure', 'headers', 'style'
      ]));
    }

    function getMediaAssets( obj, collection, mediaCwd ) {

      for( var key in obj ) {

        if( typeof obj[key] === "object" ) {
              
          getMediaAssets( obj[key], collection, mediaCwd );

        } else if( typeof obj[key] === "string" ) {

          if(obj[key].indexOf(".amazonaws.com/") >= 0 ) {
              
              var dest = obj[key].replace("http://", "").replace("https://", "");
              dest = dest.split("/");
              dest.shift();
              dest = dest.join("/");

              if( collection.indexOf(dest) < 0 ) {
                collection.push(dest);
              }

              obj[key] = mediaCwd + dest;

          }
        }
      }

      return collection;

    }

    function requestJson(url, options, done) {

      var mediaAssets = [];

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

    function requestZip(url, options, done) {

      var zipFolderName = "content-backups";
      var zipFileName = zipFolderName + "/content-dump-" + new Date().getTime() + ".zip";

      if( options.zipOut.substring( options.zipOut.length - 1 ) !== "/" ) {
        options.zipOut += "/";
      }

      //check to see if our zip folder exists.  If not, create it.
      fs.exists( options.zipOut + zipFolderName, function( fileExists ) {

        if ( !fileExists ) {
          grunt.log.ok( "Folder doesn't exist. Creating \"" + options.zipOut + zipFolderName + "\"" );
          mkdirp.sync(options.zipOut + zipFolderName);
        }

        //grab down the zip we're looking for and uncompress it
        request(url, function() {
          
          var unzipper = new DecompressZip(options.zipOut + zipFileName);
          
          unzipper.on("extract", function (log) {
            
            //on extraction of the zip, check if mediaOut is set, if so, loop through all the unzipped files, and grab down the neccesary media.
            if(options.mediaOut !== "") {

              for(var key in log) {
                var unzippedFile = options.zipOut + log[key].deflated;
                var mediaAssets = [];
                
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
            console.log(error);
            grunt.log.error("An error occurred unzipping the file:" + options.zipOut + zipFileName);
          });

          unzipper.extract({
            path: options.zipOut
          });

        }).pipe(fs.createWriteStream(options.zipOut + zipFileName));

      });

    }

    function saveMedia(options, body, done) {

      var mediaAssets = [];

      //if media doesn't end in "/", add it in.
      if( options.mediaOut.substring( options.mediaOut.length - 1 ) !== "/" ) {
        options.mediaOut += "/";
      }

      if( options.mediaCwd !== "" ) {
        if ( options.mediaCwd.substring( options.mediaCwd.length - 1 ) !== "/" ) {
            options.mediaCwd += "/";
        }
      } else {
        options.mediaCwd = options.mediaOut;
      }

      client = makeClient( options.aws );
      mediaAssets = getMediaAssets( body, mediaAssets, options.mediaCwd );

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
                grunt.log.error(util.format("Error creating directory %j: %s", destDir, err));
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
        var logArgs = null,
            logMessage = null,
            isError = false,
            doDownload = false;

        if (err) {
          logArgs = [ "Error requesting %j: %s", src, err ];
          isError = true;
        } else if (!res) {
          logArgs = [ "Empty response for %j", src ];
          isError = true;
        } else if (res.statusCode === HTTP_NOT_MODIFIED) {
          logArgs = [ "%s >> up to date", dest ];
        } else if (res.statusCode === HTTP_OK) {
          doDownload = true;
        } else {
          logArgs = [ "Unexpected response for %j: %s", url, res.statusCode ];
          isError = true;
        }

        if (logArgs) {
          var message = util.format.apply(util, logArgs);
          if (isError) {
            grunt.log.error(message);
          } else {
            grunt.log.writeln(message);
          }
        }

        if (isError || !doDownload) {
          doneCallback();
          return;
        }

        var file = fs.createWriteStream(dest);
        file.on("error", function(e) {
          grunt.log.error(util.format("Error writing to %j: %s", dest, e));
          doneCallback();
        });

        res
          .on('error', function (err) {
            grunt.log.error(util.format("Error reading %j: %s", src, err));
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

    function requestFiles() {
      grunt.log.subhead( "Retrieving files..." );
      if(doUnZip) {
        requestZip(url, options, done);
      } else {
        requestJson(url, options, done);
      }
    }

    // Mix in default options, .shampoorc file
    var options = rc("shampoo", this.options({
      api: 1,
      query: "dump/json/single-file",
      out: "data/content.json"
    }));

    var doUnZip = false;

    var done = this.async();

    if (!options.key || !options.secret) {
      grunt.log.error( "Shampoo API Key and Secret are required to use this plugin.\nGet them from your Shampoo account under 'Settings'.");
    }

    var invalids = [];

    if (!options.domain) {
      invalids.push("domain");
    }

    if (!options.query) {
      invalids.push("query");
    }

    if (!options.out) {
      invalids.push("out");
    }

    if(options.query.indexOf("dump/zip/") >= 0) {
      doUnZip = true;

      if(!options.zipOut) {
        grunt.log.error("grunt-shampoo: you've specified a query which returns a zip file.  For this type of query please specify the zipOut option in the grunt task config.");
        return false;
      }
    }

    if (invalids.length > 0) {
      grunt.log.error('grunt-shampoo is missing following options:', invalids.join(', '));
      return false;
    }

    var requestId = (new Date()).getTime() + "" + Math.floor(Math.random()*10000000);
    var token = sha256( options.secret + options.key + requestId );

    var url = "http://" + options.domain + "/api/v" + options.api + "/" + options.query + "?token=" + token + "&requestId=" + requestId;

    if (options.params) {
      url += "&" + options.params;
    }

    if (!options.mediaOut) {
      options.mediaOut = "";
    }

    if (!options.mediaCwd) {
      options.mediaCwd = "";
    }

    // Create directory if doesn't exist
    if(options.mediaOut && !fs.existsSync(options.mediaOut)){

      grunt.verbose.writeln(util.format(
        "Folder doesn't exist. Creating %j", options.mediaOut));

      mkdirp( options.mediaOut, null, function(err) {
        if(err) {
          grunt.log.error(util.format(
            "Couldn't create %j (%s)", options.mediaOut, String(err)));
        } else {
          grunt.verbose.ok(util.format(
            "Created %j", options.mediaOut));
          requestFiles();
        }
      });
    } else {
      requestFiles();
    }

  });
};