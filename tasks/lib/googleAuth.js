var inquirer = require("inquirer");
var open = require("open");

module.exports = {

	grunt: null,
	taskCallback: null,
	googleLib: null,
	oauth2Client: null,

	config: {
		google: {
			clientId: "",
			clientSecret: "", //this should be set by the .shampoo file overrides.
			redirectUrl: "http://dev.shampoo.ludomade.net/oauth2callback",
			scopes: [
				"https://www.googleapis.com/auth/drive.file"
			],
			tokens: {
				accessToken: "", //this should be set by the .shampoo file overrides.
				refreshToken: "" //this should be set by the .shampoo file overrides.
			}
		}
	},

	init: function(params) {

		//requires all these items in its "constructor".

		this.grunt = params.grunt;
		this.taskCallback = params.taskCallback;
		this.googleLib = params.googleLib;

		this.testConfig();

	},
	
	getAccessToken: function(callback) {
		
		// generate consent page url
		var self = this;
		var url = this.oauth2Client.generateAuthUrl({
			access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token) 
			scope: this.config.google.scopes // If you only need one scope you can pass it as string
		});

		this.grunt.log.writeln('We\'ve opened a browser window. Please authorize the google permissions request to connect to shampoo.');
		open(url);
		inquirer.prompt([{name: "oauthCode", message:"After authorized, enter the code supplied from your browser."}], function(response) {

			//self.grunt.log.write("here's the response given" + response.oauthCode);
			//callback(false);
			self.oauth2Client.getToken(response.oauthCode, function(err, tokens) {
				callback(err,tokens);
			});

		});

	},

	testConfig: function() {

		//test off your configuration file (if it exists)
		//merges your config file into this file's config object.
		if(this.grunt.file.exists(".shampoo")) {
			var jsonOpts = this.grunt.file.readJSON(".shampoo");

			if(typeof jsonOpts.google != "undefined") {
				
				if(typeof jsonOpts.google.clientId != "undefined") {
					this.config.google.clientId = jsonOpts.google.clientId;
				}
				if(typeof jsonOpts.google.clientSecret != "undefined") {
					this.config.google.clientSecret = jsonOpts.google.clientSecret;
				}

				if(typeof jsonOpts.google.tokens != "undefined") {

					if(typeof jsonOpts.google.tokens.accessToken != "undefined") {
						this.config.google.tokens.accessToken = jsonOpts.google.tokens.accessToken;
					}
					if(typeof jsonOpts.google.tokens.refreshToken != "undefined") {
						this.config.google.tokens.refreshToken = jsonOpts.google.tokens.refreshToken;
					}

				}
			}
		}

		if(!this.config.google.clientId.length) {
			this.grunt.log.error("Google clientId wasn't specified.  Please add a value to the key google.clientId in your .shampoo file.");
			this.taskCallback(false);
			return;
		}

		if(!this.config.google.clientSecret.length) {
			this.grunt.log.error("Google clientSecret wasn't specified.  Please add a value to the key google.clientSecret in your .shampoo file.");
			this.taskCallback(false);
			return;
		}

	},

	request: function(callBack) {

		var self = this;
		var OAuth2 = this.googleLib.auth.OAuth2;
		
		this.oauth2Client = new OAuth2(this.config.google.clientId, this.config.google.clientSecret, this.config.google.redirectUrl);
		this.googleLib.options({ auth: this.oauth2Client });

		if(this.config.google.tokens.accessToken.length) {

			//if we've saved down the access token in the .shampoo file
			this.oauth2Client.setCredentials({
				access_token: this.config.google.tokens.accessToken,
				refresh_token: this.config.google.tokens.refreshToken
			});
			callBack();

		} else {

			//if auth hasn't been saved - or an error occured previously
			this.getAccessToken(function(err,tokens) {

				if(err) {
					
					self.grunt.log.error("Shampoo error: There was an error contacting the google auth.  Try again.");

					//reset the tokens in the shampoo file.
					self.config.google.tokens.accessToken = "";
					self.config.google.tokens.refreshToken = "";

				} else {

					//write the auth token and refresh token out to the .shampoo file
					self.grunt.log.writeln("Got your google access token, thanks.  Saving it down to your .shampoo file.")
					self.config.google.tokens.accessToken = tokens.access_token;
					self.config.google.tokens.refreshToken = tokens.refresh_token;

					self.oauth2Client.setCredentials(tokens);
				}

				self.grunt.file.write(".shampoo", JSON.stringify(self.config, undefined, 4));

				if(err) {

					//tell grunt to fail
					self.taskCallback(false);

				} else {

					//fire the this modules callback
					callBack();

				}

			});

		}

	}

}