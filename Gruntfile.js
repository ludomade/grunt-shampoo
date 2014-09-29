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
        'tasks/**/*.js',
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
      json: {
        options: {
          out: "content/content.json"
        }
      },
      page: {
        options: {
          query: "page/path/characters",
          params: "children=1&meta=0",
          out: "content/content.json"
        }
      },
      media: {
        options: {
          mediaOut: "content/images/",
          mediaCwd: "images/",
          out: "content/content.json"
        }
      },
      zip: {
        options: {
          query: "dump/zip/pages/locales",
          zipOut: "content/"
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
