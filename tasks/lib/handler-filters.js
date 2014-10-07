"use strict";


var httpCodes = require("./http-codes"),
	util = require("util");


function argsToArray(args) {
	var array = [ ];
	for (var i = 0; i < args.length; i++) {
		array.push(args[i]);
	}
	return array;
}


function createHandlerFilter(grunt) {

	function logErrors(logPrefix, handler) {
		logPrefix = String(logPrefix) + ": ";
		return function (error) {
			if (error) {
				grunt.log.debug("Error: %j", error);
				grunt.log.error(logPrefix + error);
			}
			handler.apply(null, arguments);
		};
	}

	function _expectHttpCode(codeArray, handler) {
		return function (/* error, response, ... */) {
			var args = argsToArray(arguments);
			if (!args[0] && args[1]) {
				var responseCode = args[1].statusCode;
				if (codeArray.indexOf(responseCode) < 0) {
					var responseMessage = httpCodes.stringify(responseCode);
					var error = new Error(util.format(
						"HTTP %d: %s", responseCode, responseMessage));
					error.statusCode = responseCode;
					error.statusMessage = responseMessage;
					args[0] = error;
				}
			}
			handler.apply(null, args);
		};
	}

	function _expectHttpOk(handler) {
		return _expectHttpCode([httpCodes.OK, httpCodes.NOT_MODIFIED], handler);
	}

	function _expectJsonAtArgument(jsonArgNum, handler) {
		return function (/* error, ... */) {
			var args = argsToArray(arguments),
				  parsedJson = null;

			if (!args[0]) {
				try {
					parsedJson = JSON.parse(args[jsonArgNum]);
				} catch (parseError) {
					args[0] = parseError;
				}
			}
			args[jsonArgNum] = parsedJson;
			handler.apply(null, args);
		};
	}

	return {
		logErrors: logErrors,

		expectHttpOk: function (logPrefix, handler) {
			return logErrors(logPrefix, _expectHttpOk(handler));
		},

		expectJsonResponse: function (logPrefix, handler) {
			return _expectHttpOk(
				_expectJsonAtArgument(2,
					logErrors(logPrefix, handler)
				)
			);
		},

		expectJsonContents: function (logPrefix, handler) {
			return _expectJsonAtArgument(1,
				logErrors(logPrefix, handler)
			);
		}
	};
}

module.exports = createHandlerFilter;
