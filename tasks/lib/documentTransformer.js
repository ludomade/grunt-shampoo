module.exports = {
	grunt: null,
	googleLib: null,
	asyncCallback: null,
	options: null,

	init: function(params) {
		
		this.grunt = params.grunt;
		this.googleLib = params.google;
		this.asyncCallback = params.done;
		this.options = params.options;

	},
	fetch: function(callback) {

	}
	
}