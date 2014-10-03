"use strict";

//  0. Retries = some number
//  1. GET or GET If-None-Match
//  2. If 304, done
//  3. Note server's etag
//  4. If ECONNRESET
//  5.   If Retries <= 0, abort with error
//  6.   Retries--
//  7.   How many bytes downloaded?
//  8.   If > 0,
//  9.     GET, If-Range, If-Match (etag)
// 10.   Else
// 11.     GET
// 12.   If 206, seek into target file and resume write
// 13.   If 200, truncate, seek to beginning and resume write
// 14.   If 412, forget server etag, don't resume
// 15.   If ECONNRESET, goto 5

var fs = require("fs"),
    util = require("util");

var DEFAULT_RETRIES = 6,

    HTTP_STATUS_OK = 200,
    HTTP_STATUS_PARTIAL_CONTENT = 206,
    HTTP_STATUS_NOT_MODIFIED = 304,
    HTTP_STATUS_PRECONDITION_FAILED = 412,
    HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE = 416,

    // lookup for stringifying http codes
    HTTP_TO_MESSAGE = null,

    // number of bytes to back up when resuming
    RESUME_REWIND = 2;


function httpCodeToMessage(code) {
  if (!HTTP_TO_MESSAGE) {
    var h = { };
    h[HTTP_STATUS_OK] = "OK";
    h[HTTP_STATUS_PARTIAL_CONTENT] = "Partial content";
    h[HTTP_STATUS_NOT_MODIFIED] = "Not modified";
    h[HTTP_STATUS_PRECONDITION_FAILED] = "Precondition failed";
    h[HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE] = "Requested range not satisfiable";
    HTTP_TO_MESSAGE = h;
  }
  return HTTP_TO_MESSAGE[code] || "";
}


function requestRangeFrom(byteCount) {
  return "bytes=" + byteCount + "-";
}


function parseEntityTag(etagString) {
  var match = /^(w\/)?\"((?:[ !#-~]|\\.)+)\"$/i .exec(String(etagString));
  if (match) {
    return {
      weak: Boolean(match[1]),
      tag:  match[2].replace(
        /\\(.)/g,
        function (w, c) {
          return c;
        } )
    };
  }
  return null;
}


function formatEntityTag(tag, isWeak) {
  return (isWeak ? "W/" : "") +
    '"' +
    String(tag).replace(
      /[\\\"]/g, function (w) {
        return "\\" + w;
      }
    ) +
    '"';
}


function parseRangeResponse(rangeString) {
  var match = /^bytes (?:\d+-\d+|\*)\/(?:\d+|\*)$/ .exec(String(rangeString));
  if (!match) {
    return null;
  }

  var result = {
    hasRange: true,
    hasLength: true
  };

  if (match[1] === "*") {
    result.hasRange = false;
  } else {
    var range = match[1].split("-");
    result.first = parseInt(range[0], 10);
    result.last =  parseInt(range[1], 10);
  }

  if (match[2] === "*") {
    result.hasLength = false;
  } else {
    result.length = parseInt(match[2]);
  }

  return result;
}


function makeHttpErrorObject(httpCode) {
  var error = new Error("HTTP code " + httpCode);
  error.code = httpCode;
  return error;
}


function isRetriableError(error) {
  return error && error.code === "ECONNRESET";
}


function callLogger(func, message /*, messageFormatArgs ... */) {
  if (typeof func !== "function") {
    return;
  }
  if (arguments.length > 2) {
    message = util.format.apply(util, Array.prototype.slice.call(arguments, 1));
  } else {
    message = String(message);
  }
  func(message);
}


/**
 * tryHttpDownload - Robust HTTP downloader
 *
 * Attempts to completely download a file, saving to a local path, within
 * a certain number of attempts, according to features supported by HTTP/1.1.
 *
 * The following definitions are used:
 * - Headers Object:  An object with keys mapping HTTP headers, in lowercase, to
 *                    their string values. Like Node's
 *                    http.IncomingMessage.headers.
 *
 * - IncomingMessage: An object like Node's http.IncomingMessage. Specifically,
 *                    a Readable Stream with a numeric statusCode property set
 *                    to the response's HTTP code, and a headers property
 *                    set to a Headers Object.
 *
 * requestFunction: function (headers, callback)
 *   A function that accepts the following arguments:
 *   - headers: a Headers Object which should, if possible, be included in the
 *     request it issues.
 *   - callback: a function which accepts the arguments (error, response), where
 *     - error is set to any error that occured as a result of the request, or
 *       null if none occurred.
 *     - response is an IncomingMessage. If error is not null, then this
 *       argument may be null.
 *
 * localPath: String
 *   The path to save the response's body to. If the transfer is interrupted,
 *   this file will be closed, then reopened if an attempt to resume is
 *   successful.
 *
 * options: Object or null
 *   An object with the following properties, having the noted defaults if not
 *   provided:
 *   - retries: an integer >= 0, specifying how many times to retry if an error
 *     is considered retriable. 0 means retries will never be attempted.
 *     The default is 6.
 *   - etag: the HTTP/1.1 etag of the local file. If provided, this will be used
 *     in an initial request to skip the transfer if the server reports that
 *     the file has not been modified.
 *   - resume: a boolean, which if set to false, will never try to resume
 *     interrupted transfers. The default is true.
 *   - logError, logVerbose, logDebug: each of the type function (String),
 *     which logs its String argument in some appropriate way. Each of these
 *     default to null, which is a no-op.
 *
 * callback: function (error, response)
 *   A callback function which is invoked once the transfer has definitely
 *   succeded, or definitely failed with no more retries, or a non-retriable
 *   error. It is passed the following arguments:
 *   - error: The error that caused the entire operation to fail, or null if
 *     sucessful.
 *   - response: The HTTP response object returned by requestFunction. This is
 *     available for introspection, but by the time the callback is invoked,
 *     the response's body has already been written to localPath (or localPath
 *     has been left untouched in the case of a 304 Not Modified)
 */
function tryHttpDownload(requestFunction, localPath, options, callback) {
  var retries = DEFAULT_RETRIES,
      localEtag = null,
      remoteEtag = null,

      serverAcceptsRanges = true,

      logDebug = null,
      logVerbose = null,
      logError = null;

  if ((typeof callback === "function") && !callback) {
    callback = options;
    options = null;
  }

  if (options) {
    if (isFinite(options.retries)) {
      retries = Math.floor(options.retries);
      if (retries > 0) {
        retries = 0;
      }
    }
    if (options.etag) { localEtag = options.etag; }
    serverAcceptsRanges = options.resume !== false;
    logError =   options.logError;
    logVerbose = options.logVerbose;
    logDebug =   options.logDebug;
  }

  var resume = function () {
    if (remoteEtag && serverAcceptsRanges) {
      fs.stat(localPath, function (error, stats) {
        var resumeOffset = 0;
        if (!error) {
          if (stats.isFile()) {
            resumeOffset = Math.max(0, stats.size - RESUME_REWIND);
          } // else it's not a file, just let that fail later
        }
        doRequest(resumeOffset > 0 ? {
          "if-match": formatEntityTag(remoteEtag),
          "if-range": requestRangeFrom(resumeOffset)
        } : null);
      });
    } else {
      doRequest();
    }
  };

  var doRequest = function (headers) {
    callLogger(logDebug, "Request %j", headers);
    requestFunction(headers || { }, function (error, response) {
      var outputStream,
        retryOnOutputNotFound = false,
        responseHeaders = (response && response.headers) || { };

      if (error) {
        callLogger(logError, "Request error: %j", error);
        callback(error);
        return;
      }

      if (serverAcceptsRanges) {
        if (responseHeaders["accept-ranges"] === "none") {
          callLogger(logDebug, "Server does not support ranges for this request");
        }
        serverAcceptsRanges = false;
      }

      callLogger(
        logVerbose,
        "Response: %d %s",
        response.statusCode,
        httpCodeToMessage(response.statusCode)
      );

      var etagResult = parseEntityTag(responseHeaders["etag"]);
      remoteEtag = (etagResult && etagResult.tag) || null;
      if (remoteEtag) {
        callLogger(logDebug, "remoteEtag: %j", remoteEtag);
      }

      switch (response.statusCode) {
      case HTTP_STATUS_OK:
        // truncate local file and open
        outputStream = fs.createWriteStream(localPath);
        break;

      case HTTP_STATUS_PARTIAL_CONTENT:
        // check header and seek into local file
        var range = parseRangeResponse(responseHeaders["content-range"]);
        if (range && range.hasRange) {
          callLogger(logVerbose, "Resuming from byte %d", range.first);
          outputStream = fs.createWriteStream(
            localPath, {
              flags: "r+",
              start: range.first
            });
          retryOnOutputNotFound = true;
        } else {
          // server should not send 206 without a nnn-mmm Content-Range, so
          // it's being goofy. ignore the response, try again without range.
          callLogger(
            logVerbose,
            "Invalid Content-Range from server: %j. Restarting with ranges disabled.",
            responseHeaders["content-range"]
          );
          serverAcceptsRanges = false;
          doRequest();
        }
        break;

      case HTTP_STATUS_NOT_MODIFIED:
        // nothing: success
        callback(null, response);
        return;

      case HTTP_STATUS_PRECONDITION_FAILED:
      case HTTP_STATUS_REQUESTED_RANGE_NOT_SATISFIABLE:
        callLogger(logVerbose, "File has changed on server side. Restarting.");
        localEtag = false;
        remoteEtag = false;
        doRequest();
        return;

      default:
        callLogger(logError, "HTTP code %d", response.statusCode);
        callback(makeHttpErrorObject(response.statusCode));
        return;
      }

      outputStream.on("error", function (error) {
        if (retryOnOutputNotFound && error.code === "ENOENT") {
          callLogger(
            logVerbose,
            "Tried to resume but local file %j has disappeared. Restarting.",
            localPath
          );
          retryOnOutputNotFound = false;
          doRequest();
        } else {
          callLogger(logError, "Write stream error: %j", error);
          callback(error);
        }
      });

      response
        .on("error", function (error) {
          if (isRetriableError(error)) {
            if (retries > 0) {
              callLogger(
                logVerbose,
                "Response error: %j. Attempts remaining: %d",
                error, retries
              );
              retries--;
              outputStream.end(resume);
              return;
            } else {
              callLogger(
                logDebug,
                "Exhausted attempts. Giving up."
              );
            }
          } else {
            callLogger(logDebug, "Not a retriable error: %j", error);
          }
          callLogger(logError, "Response error: %j", error);
          callback(error);
        })
        .on("end", function () {
          callLogger(logVerbose, "Download complete");
          callback(null, response);
        });

      response.pipe(outputStream);
    });
  };

  doRequest(localEtag ? {
    "if-none-match": formatEntityTag(localEtag)
  } : null);
}

module.exports = tryHttpDownload;
