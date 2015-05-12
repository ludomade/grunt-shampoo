/*
 * grunt-shampoo
 * https://github.com/ludomade/grunt-shampoo
 *
 * Copyright (c) 2015 Ludomade
 * Licensed under the MIT license.
 */

'use strict';

var google = require('googleapis');
var auth = require('./lib/googleAuth');
var transformer = require('./lib/documentTransformer');

module.exports = function(grunt) {

	grunt.registerTask('shampoo', 'A grunt plugin to grab the data down from Ludomade\'s shampoo app.', function(arg) {
		
		//lets set this task as async.
		var done = this.async();

		if(!grunt.file.exists(".shampoo")) {
			grunt.log.error("No .shampoo configuration file was found.  Please create one.  See the readme (https://github.com/ludomade/grunt-shampoo/tree/shampoo3) for more info.");
			done(false);
			return;
		}

		// Merge task-specific and/or target-specific options with these defaults.
		var options = this.options({
			documentId: "",
			outputDir: "locales/",
			activeLocales: []
		});

		if(!options.documentId.length) {
			grunt.log.error("No shampoo documentId was set as an option on the Grunt task.  Add `options:{documentId:\"MyDocumentId\"}` to the grunt task configuration!");
			done(false);
		}

		if (options.activeLocales.length === 0) {
			grunt.log.error("No locales has been set in the Grunt task.  Please add `options: {activeLocales: [\"en-US\"]}` to your grunt task configuration.");
		}

		if(options.outputDir.charAt(options.outputDir.length - 1) !== "/") {
			//if the output dir's last character isn't "/", tack it on
			options.outputDir += "/";
		}

		if (arguments.length != 0) {
			//overrride the activelocales with any arguments if they've been passed.
			//this will allow for a user to grab just a specific locale if desired.
			options.activeLocales = [arg];
		}

		auth.init({
			grunt: grunt,
			googleLib: google,
			taskCallback: done
		});

		auth.request(function() {

			//this only gets called when there was a success grabbing down an API key.

			//transform the native google doc data into an array of json documents.
			transformer.init({
				grunt: grunt,
				googleLib: google,
				taskCallback: done,
				options: options,
				auth: auth
			});
			transformer.fetch(function(jsonDocuments) {

				for(var i=0; i<jsonDocuments.length; i++) {
					//write out the json document!
					var doc = jsonDocuments[i];
					grunt.file.write(options.outputDir + doc.locale + ".json", JSON.stringify(doc.data, undefined, 4));
					grunt.log.oklns("Writing " + options.outputDir + doc.locale + ".json");
				}

				done(true);

			});

		});


	});

};
