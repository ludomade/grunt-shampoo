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
    httpCodes = require("./http-codes"),
    path = require("path"),
    tmp = require("tmp"),
    util = require("util");

var DEFAULT_RETRIES = 6,

    // number of bytes to back up when resuming
    RESUME_REWIND = 2,

    // for strict mode, or does node accept octal strings as well?
    M0600 = parseInt("600", 8),
    M0644 = parseInt("644", 8),

    RETRIABLE_SYSCALL_ERRORS = {
      ECONNRESET: true,
      ETIMEDOUT:  true
    },

    _moduleTempDir = null,
    _tempFileId = 0;


function getTempDir(callback) {
  if (_moduleTempDir === null) {
    tmp.dir({ unsafeCleanup: true }, function (error, tempDirPath) {
      if (!error) {
        _moduleTempDir = tempDirPath;
      }
      callback(error, _moduleTempDir);
    });
  } else {
    process.nextTick(function () {
      callback(null, _moduleTempDir);
    });
  }
}


function getTempFileName(callback) {
  getTempDir(function (error, tempDirPath) {
    if (error) {
      callback(error, null);
    } else {
      var name = (_tempFileId++).toString(36);
      callback(null, path.join(tempDirPath, name));
    }
  });
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
  var match = /^bytes ((\d+)-(\d+)|\*)\/(\d+|\*)$/ .exec(String(rangeString));
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
    result.first = parseInt(match[2], 10);
    result.last =  parseInt(match[3], 10);
  }

  if (match[4] === "*") {
    result.hasLength = false;
  } else {
    result.length = parseInt(match[4], 10);
  }

  return result;
}


function makeHttpErrorObject(httpCode) {
  var httpError = new Error("HTTP code " + httpCode);
  httpError.code = httpCode;
  return httpError;
}


function isRetriableError(error) {
  return Boolean(error && RETRIABLE_SYSCALL_ERRORS[error.code]);
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


var tryHttpDownload, _tryHttpDownload;

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
tryHttpDownload = function (requestFunction, localPath, options, callback) {
  if ((typeof callback === "function") && !callback) {
    callback = options;
    options = null;
  }

  if (!options) {
    options = { };
  }

  var vOptions = {
    retries:    DEFAULT_RETRIES,
    etag:       null,
    resume:     options.resume !== false,
    logError:   options.logError || null,
    logVerbose: options.logVerbose || null,
    logDebug:   options.logDebug || null
  };

  if (isFinite(options.retries)) {
    vOptions.retries = Math.floor(+options.retries);
    if (vOptions.retries < 0) {
      vOptions.retries = 0;
    }
  }

  if (options.etag || options.etag === "") {
    vOptions.etag = String(options.etag);
  }

  getTempFileName(function (error, tempFilePath) {
    if (error) {
      callLogger(vOptions.logError, "Couldn't create temporary directory: %j", error);
      callback(error, null);
    } else {
      _tryHttpDownload(requestFunction, tempFilePath, localPath, vOptions, callback);
    }
  });
};

_tryHttpDownload = function(requestFunction, fsPath, finalPath, options, callback) {
  var totalRetries = options.retries,
      retriesLeft = totalRetries,
      localEtag = options.etag,
      remoteEtag = null,

      serverAcceptsRanges = options.resume,

      logError =   options.logError,
      logVerbose = options.logVerbose,
      logDebug =   options.logDebug;

  callLogger(logDebug, "fsPath=%j, finalPath=%j", fsPath, finalPath);

  var resume = function () {
    callLogger(logDebug, "Attempting to resume. remoteEtag=%j, serverAcceptsRanges=%j", remoteEtag, serverAcceptsRanges);
    if (remoteEtag && serverAcceptsRanges) {
      fs.stat(fsPath, function (statError, stats) {
        var resumeOffset = 0;
        if (!statError) {
          if (stats.isFile()) {
            resumeOffset = Math.max(0, stats.size - RESUME_REWIND);
          } // else it's not a file, just let that fail later
        }
        doResumeRequest(resumeOffset);
      });
    } else {
      doUserRequest();
    }
  };

  var checkRetry = function (error) {
    if (isRetriableError(error)) {
      if (retriesLeft > 0) {
        retriesLeft--;
        callLogger(
          logError,
          "Retrying %s (%d/%d)",
          finalPath,
          totalRetries - retriesLeft,
          totalRetries
        );
        resume();
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
    callback(error);
  };

  var moveFile = function (fromPath, toPath, moveCallback) {
    var fromStream = fs.createReadStream(fromPath),
        toStream = fs.createWriteStream(toPath, { mode: M0644 });

    callLogger(logVerbose, "Moving %s -> %s", fromPath, toPath);

    function copyErrorHandler(copyError) {
      fromStream.unpipe();
      toStream.end();
      callLogger(logError, "Error moving %s to %s: %j", fromPath, toPath, copyError);
      moveCallback(copyError);
    }

    toStream.once("error", copyErrorHandler);
    fromStream
      .once("error", copyErrorHandler)
      .once("end", function () {
        fs.unlink(fromPath, function (unlinkError) {
          if (unlinkError) {
            callLogger(logError, "Error removing %s: %j", fromPath, unlinkError);
          }
          moveCallback();
        });
      });

    fromStream.pipe(toStream);
  };

  var doRequest = function (headers) {
    headers = headers || { };
    callLogger(logDebug, "Request %j", headers );
    requestFunction(headers, function (requestError, response) {
      var responseHeaders = (response && response.headers) || { },
          outputStream;

      if (requestError) {
        callLogger(logError, "Request error: %j", requestError);
        checkRetry(requestError);
        return;
      }

      callLogger(
        logVerbose,
        "Response: %d %s",
        response.statusCode,
        httpCodes.stringify(response.statusCode)
      );
      callLogger(logDebug, "Headers: %j", responseHeaders);

      if (serverAcceptsRanges) {
        if (responseHeaders["accept-ranges"] === "none") {
          callLogger(logDebug, "Server does not support ranges for this request");
          serverAcceptsRanges = false;
        }
      }

      var etagResult = parseEntityTag(responseHeaders["etag"]);
      remoteEtag = (etagResult && etagResult.tag) || null;
      callLogger(logDebug, "remoteEtag: %j", remoteEtag);

      switch (response.statusCode) {
      case httpCodes.OK:
        localEtag = null;
        // truncate local file and open
        outputStream = fs.createWriteStream(fsPath, { mode: M0600 });
        break;

      case httpCodes.PARTIAL_CONTENT:
        localEtag = null;
        // check header and seek into local file
        var range = parseRangeResponse(responseHeaders["content-range"]);
        if (range && range.hasRange) {
          callLogger(logVerbose, "Resuming from byte %d", range.first);
          outputStream = fs.createWriteStream(
            fsPath, {
              flags: "r+",
              start: range.first
            });
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

      case httpCodes.NOT_MODIFIED:
        // nothing: success
        callback(null, response);
        return;

      case httpCodes.PRECONDITION_FAILED:
      case httpCodes.REQUESTED_RANGE_NOT_SATISFIABLE:
        callLogger(logVerbose, "File has changed on server side. Restarting...");
        localEtag = null;
        remoteEtag = null;
        doRequest();
        return;

      default:
        localEtag = null;
        callLogger(logError, "HTTP code %d", response.statusCode);
        callback(makeHttpErrorObject(response.statusCode));
        return;
      }

      outputStream.once("error", function (writeError) {
        callLogger(logError, "Write stream error: %j", writeError);
        callback(writeError);
      });

      response
        .once("error", function (responseError) {
          callLogger(logError, "Response error: %j", responseError);
          outputStream.end(function () {
            checkRetry(responseError);
          });
        })
        .once("end", function () {
          callLogger(logVerbose, "Download complete");
          moveFile(fsPath, finalPath, function (moveError) {
            callback(moveError, moveError ? null : response);
          });
        });

      response.pipe(outputStream);
    });
  };

  var doUserRequest = function () {
    doRequest(localEtag ? {
      "If-None-Match": formatEntityTag(localEtag)
    } : null);
  };

  var doResumeRequest = function (resumeOffset) {
    doRequest(resumeOffset > 0 ? {
      "If-Match": formatEntityTag(remoteEtag),
      "Range":    requestRangeFrom(resumeOffset)
    } : null);
  };

  doUserRequest();
};

module.exports = tryHttpDownload;
