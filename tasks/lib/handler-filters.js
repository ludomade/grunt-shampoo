"use strict";

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
				grunt.log.error(logPrefix + error);
			}
			handler.apply(null, arguments);
		};
	}

	function _expectHttpCode(codeArray, handler) {
		return function (/* error, response, ... */) {
			var args = argsToArray(arguments);
			if (!args[0]) {
				if (codeArray.indexOf(args[1].statusCode) < 0) {
					args[0] = new Error("HTTP code " + args[1].statusCode);
				}
			}
			handler.apply(null, args);
		};
	}

	function _expectHttpOk(handler) {
		return _expectHttpCode([200, 304], handler);
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
