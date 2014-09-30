"use strict";

var crypto = require("crypto"),
    fs = require("fs"),
    request = require("request"),
    _ = require('lodash');


var hashStream =
exports.hashStream = function (stream, hasher, callback) {
  if (typeof hasher === "string") {
    hasher = crypto.createHash(hasher);
  }

  stream.on("end", function () {
    callback(null, hasher);
  });

  stream.on("error", function (error) {
    callback(error, null);
  });

  stream.on("data", function (chunk) {
    hasher.update(chunk);
  });
};


exports.hashFile = function (path, hasher, callback) {
  hashStream(fs.createReadStream(path), hasher, callback);
};


exports.downloadToFile = function (uri, path, options, callback) {
  if ((typeof options === 'function') && !callback) {
    callback = options;
    options = { };
  }

  var writeStreamOptions = _.pick(options, [ "encoding", "mode" ]);
  var requestOptions = _.omit(options, [ "flags", "mode" ]);

  var outStream = fs.createWriteStream(path, writeStreamOptions);
  outStream.on("error", function (error) {
    callback(error, null);
  });

  request(uri, requestOptions, function (error, response) {
    callback(error, response);
  }).pipe(outStream);
};
