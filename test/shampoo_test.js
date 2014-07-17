'use strict';

var grunt = require('grunt');

exports.shampoo = {

  test: function(test) {
    test.expect(1);
    test.equal(true, true, 'should return true.');
    test.done();
  }

};
