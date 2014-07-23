/*
 * grunt-shampoo
 * https://github.com/soapcreative/grunt-shampoo
 *
 * Copyright (c) 2014 Soap Creative
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  grunt.initConfig({
    jshint: {
      all: [
        'Gruntfile.js',
        'tasks/*.js',
        '<%= nodeunit.tests %>'
      ],
      options: {
        jshintrc: '.jshintrc'
      }
    },

    clean: {
      tests: ['tmp']
    },

    nodeunit: {
      tests: ['test/*_test.js']
    },

    shampoo: {
      options: {
        privateConfig: grunt.file.readJSON("./shampoo-config.json"),
        domain: "dev.shampoo2.app",
        type: "dump",
        format: "json",
        mediaOut: "app/images/"
      },
      en: {
        options: {
          query: "locale/en",
          out: "app/content/en.json"
        }
      },
      fr: {
        options: {
          query: "locale/fr",
          out: "app/content/fr.json"
        }
      }
    }

  });

  grunt.loadTasks('tasks');

  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-nodeunit');

  grunt.registerTask('test', ['clean', 'nodeunit']);

  grunt.registerTask('default', ['jshint', 'test']);

};
