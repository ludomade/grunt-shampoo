/*
 * grunt-shampoo
 * https://github.com/soapcreative/grunt-shampoo
 *
 * Copyright (c) 2014 Soap Creative
 * Licensed under the MIT license.
 */

'use strict';

var request = require("request"),
    async = require("async"),
    sha256 = require("sha256"),
    fs = require("fs"),
    knox = require("knox"),
    deferred = require('underscore.deferred'),
    crypto = require('crypto'),
    rc = require('rc'),
    DecompressZip = require('decompress-zip'),
    fs = require('fs'),
    util = require('util'),
    mkdirp = require('mkdirp');

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
        response = response || { statusCode: 0 };
        body = JSON.parse( body );
        if( body.error ) {
          grunt.log.error( "Error: " + body.message );
          return done( body.message );
        } else if (error) {
          return done( error );
        } else if ((response.statusCode < 200 || response.statusCode > 399)) {
          return done( "[" + response.statusCode + "] " + body );
        }
        
        if( options.out ) {
          if( options.mediaOut !== "" ) {

            saveMedia(options, body, done);

          } else {

            writeJsonFile( options.out, body );
            done();

          }
        }
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

      var relativeToBucket = "";

      relativeToBucket = dest;
      dest = mediaOut + dest;

      //first check to see if the dest file exists in our project
      fs.exists( dest, function( fileExists ) {

        if ( fileExists ) {

          //if the file exists, lets check to see if it needs to be re-downloaded.
          client.headFile( relativeToBucket, function( err, res ) {

            if( res.headers && res.headers.etag ) {
              // Let through
            } else {
              if( res.headers.etag == undefined ) {
                grunt.log.write( dest + " ");
                grunt.log.error( "unable to retrieve remote file header, skipped." );
                doneCallback();
                return;                
              }
            }

            var localHash = "";
            var remoteHash = res.headers.etag.replace(/"/g, '');

            //grab the remote etag from AWS, and compare it against a md5 of our local file.
            fs.readFile( dest, function ( err, data ) {

              localHash = crypto.createHash('md5').update(data).digest('hex');
              if ( remoteHash === localHash ) {
                //we don't need to download this file - its the same as what we've got.
                grunt.log.write( dest + " ");
                grunt.log.error( "skipped" );
                doneCallback();
                return;

              } else {

                //the file hashes don't match, so we need to re-download it.
                downloadFile( dest, relativeToBucket, doneCallback );

              }

            });

          });
        
        } else {

          //we don't have this file in our system, so download it.

          var destDir = dest.split("/");
          destDir.pop();
          destDir = destDir.join("/");

          fs.exists(destDir, function(dirExists) {
            
            //create the directory if it doesn't exist.
            if(dirExists) {

              downloadFile(dest, relativeToBucket, doneCallback);

            } else {

              mkdirp(destDir, null, function(err){
                
                downloadFile(dest, relativeToBucket, doneCallback);

              });

            }

          });

        }

      });

    }

    function writeJsonFile(out, body) {
      grunt.log.subhead( "Retrieving content..." );
      grunt.log.write( out + " ") + grunt.log.ok( "saved" );
      grunt.file.write(out, JSON.stringify(body, null, '\t'));

    }

    function downloadFile(dest, src, doneCallback) {

      // Create a local stream we can write the downloaded file to.
      var file = fs.createWriteStream(dest);
      file.on("error", function(e) {
        grunt.log.error("Error creating file: " + dest);
        doneCallback()
        return;
      });

      client.getFile(src, function (err, res) {

        // If there was an upload error or any status other than a 200, we
        // can assume something went wrong.
        if (err || res.statusCode !== 200) {
          grunt.log.error("Error retrieving file: " + dest);
          doneCallback();
          return;
        }

        res
          .on('data', function (chunk) {
            file.write(chunk);
          })
          .on('error', function (err) {
            grunt.log.error("AWS error for file: " + dest);
            doneCallback();
            return;
          })
          .on('end', function () {
            file.end();
            grunt.log.write( dest + " " );
            grunt.log.ok( "downloaded" );
            doneCallback();
          });
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

    var url = "http://" + options.domain + "/api/v" + options.api + "/" + options.query + "?token=" + token + "&requestId=" + requestId

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