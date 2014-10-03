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


function isJsonValue(v) {
  if (v == null) {
    return true;
  }
  switch (typeof v) {
  case "number":
  case "string":
  case "boolean":
    return true;
  }
  return false;
}

function containerOfType(i) {
  if (isJsonValue(i)) {
    return null;
  }
  if (Array.isArray(i)) {
    return [ ];
  }
  return { };
}

exports.transformJson = function (obj, func, thisArg) {
  if (isJsonValue(obj)) {
    return func.call(thisArg, obj, null, null, null);
  }

  var inq = [ obj ],
      result = containerOfType(obj),
      outq = [ result ],
      keyPaths = [ [ ] ];

  var inObj, outObj, parentKeyPath, currentKeyPath;

  var processPair = function (v, k) {
    currentKeyPath = parentKeyPath.slice();
    currentKeyPath.push(k);

    if (isJsonValue(v)) {
      outObj[k] = func.call(thisArg, v, k, inObj, currentKeyPath);
    } else {
      var newContainer = containerOfType(v);
      outObj[k] = newContainer;
      inq.push(v);
      outq.push(newContainer);
      keyPaths.push(currentKeyPath);
    }
  };

  while (inq.length > 0) {
    inObj = inq.shift();
    outObj = outq.shift();
    parentKeyPath = keyPaths.shift();
    _.forOwn(inObj, processPair);
  }

  return result;
};
