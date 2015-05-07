/*
 * shampoo
 * http://shampoo.io
 *
 * Copyright (c) 2015 George Huber
 * Licensed under the MIT license.
 */

'use strict';

var google = require('googleapis');
var auth = require('./lib/googleAuth');

module.exports = function(grunt) {

	grunt.registerMultiTask('shampoo', 'A grunt plugin to grab the data down from Ludomade\'s shampoo app.', function() {
		
		// Merge task-specific and/or target-specific options with these defaults.
		var options = this.options({
			documentId: ""
		});

		//let's set this task as async.
		var done = this.async();

		auth.init({
			grunt: grunt,
			googleLib: google,
			asyncCallback: done
		});

		auth.request(function() {

			//this only gets called when there was a success grabbing down an API key.

		});

		//done(false);

	});

};
