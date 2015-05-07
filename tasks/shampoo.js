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
var transformer = require('./lib/documentTransformer');

module.exports = function(grunt) {

	grunt.registerTask('shampoo', 'A grunt plugin to grab the data down from Ludomade\'s shampoo app.', function(arg) {
		
		// Merge task-specific and/or target-specific options with these defaults.
		var options = this.options({
			documentId: "",
			activeLocales: []
		});

		if(!options.documentId.length) {
			grunt.log.error("No shampoo documentId was set as an option on the Grunt task.  Add `options:{documentId:\"MyDocumentId\"}` to the grunt task configuration!");
			done(false);
		}

		if (options.activeLocales.length === 0) {
			grunt.log.error("No locales has been set in the Grunt task.  Please add `options: {activeLocales: [\"en-US\"]}` to your grunt task configuration.");
		}

		if (arguments.length != 0) {
			options.activeLocales = [arg];
		}

		//let's set this task as async.
		var done = this.async();

		auth.init({
			grunt: grunt,
			googleLib: google,
			asyncCallback: done
		});

		auth.request(function() {

			//this only gets called when there was a success grabbing down an API key.
			transformer.init({
				documentId: options.documentId,
				locales: locales
			})
			done(true);

		});


	});

};
