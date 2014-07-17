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
    sha256 = require("sha256");

module.exports = function(grunt) {
  grunt.registerMultiTask( "shampoo", "Retrieve content from the Shampoo CMS API on shampoo.io.", function() {

    var options = this.options({
      ignoreErrors: false,
      api: 1,
      format: "json",
      type: "dump",
      query: "single-file",
      out: "data/content.json"
    });

    var done = this.async();

    var invalids = [];

    if (!options.domain) {
      invalids.push("domain");
    }

    if (!options.format) {
      invalids.push("format");
    }

    if (!options.type) {
      invalids.push("type");
    }

    if (!options.query) {
      invalids.push("query");
    }

    if (!options.out) {
      invalids.push("out");
    }

    if (!options.key || !options.secret) {
      grunt.log.error( "API Key and Secret required. Get them from your Shampoo account under 'Settings'.");
    }

    if (invalids.length > 0) {
      grunt.log.error('grunt-shampoo is missing following options:', invalids.join(', '));
      return false;
    }

    var requestId = (new Date()).getTime() + "" + Math.floor(Math.random()*10000000);
    var token = sha256( options.secret + options.key + requestId );

    var url = "http://" + options.domain + ".shampoo.io/api/v" + options.api + "/" + options.type + "/" + options.format + "/" + options.query + "?token=" + token + "&requestId=" + requestId;

    request(url, function( error, response, body ) {
      response = response || { statusCode: 0 };
      body = JSON.parse( body );
      if( body.error ) {
        grunt.log.error( "Error: " + body.message );
        return done( body.message );
      } else if (error) {
        return done(error);
      } else if ((response.statusCode < 200 || response.statusCode > 399)) {
        return done(response.statusCode + " " + body);
      }
      
      grunt.log.ok(response.statusCode);

      if(options.out) {
        grunt.log.ok( "Content saved locally" );
        grunt.file.write(options.out, JSON.stringify(body));
      }

      done();

    });

  });
  
};
