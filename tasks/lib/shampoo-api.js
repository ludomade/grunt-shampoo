"use strict";

var sha256 = require("sha256"),
    querystring = require('querystring');


var createToken =
exports.createToken = function (secret, key, requestId) {
  return sha256("" + secret + key + requestId);
};


var createRequestId =
exports.createRequestId = function () {
  return Date.now().toString(36) +
    (Math.random() * 9007199254740992).toString(36);
};


exports.isZipQuery = function (query) {
  return /^\/?dump\/zip\// .test(query);
};


exports.createApiUrl = function (options, requestId) {
  var url = [
      options.https ? "https" : "http",
      "://",
      options.domain,
      "/api/v",
      options.api,
      "/",
      options.query
    ].join("");

  if (!requestId) {
    requestId = createRequestId();
  }

  var queryParams = querystring.stringify({
      requestId: requestId,
      token: createToken(options.secret, options.key, requestId)
  });

  var userParams = "";
  if (options.params) {
    if (typeof options.params === "string") {
      userParams = options.params;
    } else {
      userParams = querystring.stringify(options.params);
    }
  }

  if (userParams) {
    queryParams += "&" + userParams;
  }

  return url + "?" + querystring.stringify(queryParams);
};
