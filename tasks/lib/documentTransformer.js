module.exports = {
	
	auth: null,
	grunt: null,
	googleLib: null,
	taskCallback: null,
	options: null,
	localesLookup: null,

	init: function(params) {
			
		this.jsonDocuments = null;
		this.localesLookup = {};
		this.grunt = params.grunt;
		this.googleLib = params.googleLib;
		this.taskCallback = params.taskCallback;
		this.options = params.options;
		this.auth = params.auth;

	},
	fetch: function(callback) {

		var self = this;
		var drive = this.googleLib.drive({ version: 'v2', auth: this.auth.oauth2Client });

		drive.realtime.get({
			fileId: this.options.documentId
		}, function(err, response) {

			if(err) {
				
				//if an error occurred stop execution.
				self.grunt.log.error("Sorry, an error occurred grabbing this shampoo document access this shampoo document. Google chucked the error:" + JSON.stringify(err) );
				if(typeof err.code != "undefined") {
					if(err.code === 401) {
						self.grunt.log.error("If you know for sure you have access to this document, please run the task again and we'll try your credentials again.");
						self.auth.logout();
					}
				}
				self.taskCallback(false);

			} else {
				
				self.jsonDocuments = [];
				self.parseDocument(response);
				callback(self.jsonDocuments);

			}

		});

	},

	buildLocalesLookup: function(locales) {

		for(var i=0; i<locales.length; i++) {
			var locale = locales[i];
			this.localesLookup[locale.id] = locale.value.code.value;
		}

	},

	parseDocument: function(jsonDoc) {

		if(jsonDoc.data == null) {
			this.grunt.log.error("There is no data in this document, or your access to it is insufficient.");
			return;
		}

		var documentLocales = jsonDoc.data.value.locales.value;
		var nodes = jsonDoc.data.value.nodes.value;

		this.buildLocalesLookup(documentLocales);

		//cruise through all the locales we're wishing to grab.
		for(var i=0; i<this.options.activeLocales.length; i++) {
			var requestedLocale = this.options.activeLocales[i];
			var localeExists = false;

			//check to see if that locale exists in the json doc
			for(var j=0; j<documentLocales.length; j++) {
				var docLocale = documentLocales[j];
				if(docLocale.value.code.value === requestedLocale) {
					localeExists = true;
				}
			}

			//if it exists, append a json object to the jsonDocuments array.
			if(localeExists) {

				var obj = this.getJsonObj(nodes, requestedLocale);
				this.jsonDocuments.push({
					locale: requestedLocale,
					data: obj
				});

			} else {

				this.grunt.log.warn("The requested locale (" + requestedLocale + ") as been skipped.  It looks like it doesn't exist in this shampoo document.  Please check shampoo and try again.");

			}
		}
		
		//this.grunt.log.writeln(JSON.stringify(jsonDoc));

	},

	getJsonObj: function(nodes, localeCode) {

		var array = nodes;
		var returnObj = {};

		//loop through all nodes (nodes are always a list of lists)
		for(var i=0; i<array.length; i++) {
			
			var child = array[i].value;

			///

			if(child.controlType.value === "array_objects") {

				//array of objects needs a special case.  The child data is nested 2 arrays deep.
				//the first layer of children are nodes with a control type of "array_object_group"
				//the second layer is the actual data you'll want to collect
				returnObj[child.name.value] = [];

				//console.log(returnObj);

				if(child.children.value.length) {

					var childrenObjectGroups = child.children.value;

					for(var j=0; j<childrenObjectGroups.length; j++) {
						
						//these are the array_object_group's
						var objectGroup = childrenObjectGroups[j].value;
						var doRenderItem = true;

						if(typeof objectGroup.disabledChildrenLocales != "undefined") {
							//disabledChildrenLocales is a list of google node id's - not locale codes.
							//loop through all the items, and check if the current localeCode is present in that list.
							//if so, skip the rendering of this item.

							if(objectGroup.disabledChildrenLocales.value.length > 0) {
								for(var k=0; k<objectGroup.disabledChildrenLocales.value.length; k++) {

									var localeId = objectGroup.disabledChildrenLocales.value[k].json;
									if(this.localesLookup[localeId] === localeCode) {
										doRenderItem = false;
									}

								}
							}
						}

						if(doRenderItem) {
							
							var objectGroupData = this.getJsonObj(objectGroup.children.value, localeCode);
							returnObj[child.name.value].push(objectGroupData);

						}

					}

				}
				

			} else {

				//if the name has been set and isn't null
				if(child.name.value.length) {
						
					if(child.val.value != null) {
												
						//if we're rendering a single locale.
						//var itemVal = child.val.value.get(localeCode);
						var itemVal = null;
						if(typeof child.val.value[localeCode] != "undefined") {
							itemVal = child.val.value[localeCode].json
						}

						if(child.children.value.length) {

							//check to see if it has children. If so, we need to create an object and add its children as the object's value
							returnObj[child.name.value] = {};
															
						} else {
							returnObj[child.name.value] = itemVal;
						}
						
					}

					if(child.children.value.length) {

						//if this node has children, let's loop recursively and grab all its child data.
						var grandChildObj = this.getJsonObj(child.children.value, localeCode);
						
						for(var key in grandChildObj) {
							returnObj[child.name.value][key] = grandChildObj[key];
						}

					}

				}

			}

		}

		return returnObj;

	}

}