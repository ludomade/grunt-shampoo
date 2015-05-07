module.exports = {

	grunt: null,
	asyncCallback: null,
	googleLib: null,
	oauth2Client: null,

	config: {
		google: {
			clientId: "",
			clientSecret: "", //this should be set by the .shampoo file overrides.
			redirectUrl: "http://dev.shampoo.ludomade.net/oauthredirect",
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
		this.asyncCallback = params.asyncCallback;
		this.googleLib = params.googleLib;

		this.testConfig();

	},
	
	getAccessToken: function(callback) {
		
		// generate consent page url

		var url = this.oauth2Client.generateAuthUrl({
			access_type: 'offline', // 'online' (default) or 'offline' (gets refresh_token) 
			scope: this.config.google.scopes // If you only need one scope you can pass it as string
		});

		this.grunt.log.write('Visit the url: ', url);
		callback(false);
		// rl.question('Enter the code here:', function(code) {
		// 	// request access token
		// 	oauth2Client.getToken(code, function(err, tokens) {
		// 		callback(err,tokens);
		// 	});
		// });
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
			this.asyncCallback(false);
			return;
		}

		if(!this.config.google.clientSecret.length) {
			this.grunt.log.error("Google clientSecret wasn't specified.  Please add a value to the key google.clientSecret in your .shampoo file.");
			this.asyncCallback(false);
			return;
		}

	},

	request: function(callBack) {

		var OAuth2 = this.googleLib.auth.OAuth2;
		
		this.oauth2Client = new OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUrl);
		this.googleLib.options({ auth: this.oauth2Client });

		if(config.google.tokens.accessToken.length && config.google.tokens.refreshToken.length) {

			//if we've saved down the access token in the .shampoo file
			this.oauth2Client.setCredentials({
				access_token: config.google.tokens.accessToken,
				refresh_token: config.google.tokens.refreshToken
			});
			callBack();

		} else {

			//if auth hasn't been saved - or an error occured previously
			auth.getAccessToken(function(err,tokens) {

				if(err) {
					
					this.grunt.log.error("Shampoo error: There was an error contacting the google auth.  Try again.");

					//reset the tokens in the shampoo file.
					config.google.tokens.accessToken = "";
					config.google.tokens.refreshToken = "";

				} else {

					//write the auth token and refresh token out to the .shampoo file
					config.google.tokens.accessToken = tokens.access_token;
					config.google.tokens.refreshToken = tokens.refresh_token;

					this.oauth2Client.setCredentials(tokens);
				}

				this.grunt.file.write(".shampoo", JSON.stringify(config));

				if(err) {

					//tell grunt to fail
					this.asyncCallback(false);

				} else {

					//fire the this modules callback
					callBack();

				}

			});

		}

	}

}