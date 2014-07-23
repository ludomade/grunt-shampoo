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

Next, create a file named 'shampoo-config.json', located in the same directory as the gruntfile utilizing the grunt shampoo task.
It's important you ignore this file from your code repository, as it will contain sensitive information.
The json file has the following format:

```js
{
  "aws": {
    "key" : "myAWSKeyHere",
    "secret": "myAWSSecretHere",
    "bucket": "myAwsBucketNameHere"
  },
  "shampoo": {
    "key": "myShampooKeyHere",
      "secret": "myShampooKeyHere"
  }
}

note, the AWS items are only required if you've set the shampoo.options.
```

## The "shampoo" task

### Overview
In your project's Gruntfile, add a section named `shampoo` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  shampoo: {
    options: {
      privateConfig: grunt.file.readJSON("./shampoo-config.json"),
      domain: "yourdomain.io",
      type: "dump",
      format: "json",
      mediaOut: "app/images/"
    },
    en: {
      options: {
        query: "locale/en",
        out: "app/content/en.json"
      }
    }
  },
});
```

### Options

#### options.domain
Type: `String`
Default value: none
Required

The domain name of your Shampoo.io site. If your Shampoo installation is `http://soap.shampoo.io`, then you would enter in `soap` here.

#### options.out
Type: `String`
Default value: none
Required

The path of the output file to save the API response to. Be sure the file extention matches with the format.

```
out: "data/content.json"
```

#### options.api
Type: `Number`
Default value: `1`
Required

The version of the API to access.

#### options.type
Type: `String`
Default value: `dump`

The type of API call you would like to make. `dump` is set by default - content dumps are useful for pulling down content from Shampoo in one go.

Possible types are: `dump`, `page`, `pages`, `models`, `model`, `locales` and `locale`.

#### options.format
Type: `String`
Default value: `json`

The format of the content output. 

Possible types are: `json` and `zip`.

#### options.query
Type: `String`
Default value: none

The query parameter of the API call to make. Currently, this value is appended to the end of the API call and you may append the URL path and query parameters to this field.

This value could be `single-file` or `single-file?meta=1`.

#### options.mediaOut
Type: `String`
Default value: none

If you'd like to save down all of the media data that's been uploaded to AWS S3, specify a directory relative to the Gruntfile.js, which determines where the media is saved.  Note, this is done in a smart way, where only images that have been update on S3 get downloaded.  Not every image/asset is downloaded every time.

Keep in mind, valid AWS S3 credentials are required in your shampoo-config.json file.    


### Usage Examples

In this example, the common options are set with credentials and shared options. Individual tasks are set with custom options to retrieve content by locale.

```js
shampoo: {
      options: {
        privateConfig: grunt.file.readJSON("./shampoo-config.json"),
        domain: "dev.shampoo2.app",
        type: "dump",
        format: "json",
        mediaOut: "app/images/"
      },
      en: {
        options: {
          query: "locale/en",
          out: "app/content/en.json"
        }
      },
      fr: {
        options: {
          query: "locale/fr",
          out: "app/content/fr.json"
        }
      }
    }
```

## About Shampoo

Shampoo is a CMS developed by some folks at Soap Creative, hosted at http://shampoo.io. It is currently in active development.

## Contributing

If you are a user of Shampoo and use this plugin, please contribute and help keep the plugin up to date with the API.

## Release History
_(Initial)_
