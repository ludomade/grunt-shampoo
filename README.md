# grunt-shampoo

> Retrieve content from the Shampoo CMS API on shampoo.io.

## Getting Started
This plugin requires Grunt `~0.4.5`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-shampoo --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-shampoo');
```

Shampoo requires private credentials to access content. These can be stored either in the Gruntfile options, or 
in a configuration file `.shampoorc` (recommended) and ignored from the GIT repository.

```js
{
  "aws": {
    "key" : "myAWSKeyHere",
    "secret": "myAWSSecretHere",
    "bucket": "myAWSBucketNameHere"
  },
  "key": "myShampooKeyHere",
  "secret": "myShampooSecretHere"
}

```

Note: The AWS items are only required if you've set the `shampoo.options.mediaOut` path.

## The "shampoo" task

### Overview
In your project's Gruntfile, add a section named `shampoo` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  shampoo: {
    options: {
      domain: "yourdomain.shampoo.io",
      mediaOut: "app/images/"
    },
    en: {
      options: {
        query: "dump/json/locale/en",
        out: "content/en.json"
      }
    },
    fr: {
      options: {
        query: "dump/json/locale/fr",
        out: "content/fr.json"
      }
    }
  }
});
```

### Options

#### options.domain
Type: `String`
Default value: none
Required

The full domain name of your `shampoo.io` site. If your Shampoo installation is `http://soap.shampoo.io`, then you would enter in `soap.shampoo.io` here.

#### options.api
Type: `Number`
Default value: `1`
Required

The version of the API to access.

#### options.query
Type: `String`
Default value: `dump/json/single-file`

The full query of the API call. See Shampoo API documentation for all possible outputs.

`dump` are content dumps useful for pulling down content from Shampoo in one go.

Possible types for this segment are: `dump`, `page`, `pages`, `models`, `model`, `locales` and `locale`.

For the second segment, the following formats are available: `json` and `zip`.

`single-file` outputs all content in Shampoo in one file. `single-file?meta=1` 

#### options.out
Type: `String`
Default value: none
Required

The path of the output file to save the API response to. Be sure the file extention matches with the format.

```
out: "data/content.json"
```

#### options.mediaOut
Type: `String`
Default value: none
Optional

Save down all media files that have been uploaded to AWS S3 by specifying a directory relative to the project root. Only images that have not yet been downloaded from S3 will download, effectively keeping your local media files synced down with S3.

Note: Valid AWS S3 credentials are required in the `.shampoorc` configuration.    

#### options.mediaCwd
Type: `String`
Default value: none
Optional

Specify relative media path to be output in JSON if different from `mediaOut`. E.g. If you download media files to `app/images/` but would like your image path in the JSON to be output as `images/`, you can specify so with this option.  

### Usage Examples

In this example, the common options are set with credentials and shared options. Individual tasks are set with custom options to retrieve content by locale.

```js
shampoo: {
  options: {
    domain: "yoursite.shampoo.io",
    mediaOut: "app/images/",
    mediaCwd: "images/"
  },
  en: {
    options: {
      query: "dump/json/locale/en",
      out: "app/content/en.json"
    }
  },
  fr: {
    options: {
      query: "dump/json/locale/fr",
      out: "app/content/fr.json"
    }
  }
}
```

## About Shampoo

Shampoo is a CMS developed by some folks at Soap Creative, hosted on http://shampoo.io. It is currently in active development.

## Contributing

If you are a user of Shampoo and use this plugin, please contribute and help keep the plugin up to date with the API.

## Release History


