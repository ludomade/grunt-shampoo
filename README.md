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

## The "shampoo" task

### Overview
In your project's Gruntfile, add a section named `shampoo` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  shampoo: {
    options: {
      domain: "yourdomain",
      type: "dump",
      format: "json",
      key: "yourapikey",
      secret: "yourapisecret"
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

#### options.key
Type: `String`
Default value: none
Required

An API key is required to access the Shampoo API. You must be an administrator and you can generate a new key and secret at `http://yourdomain.shampoo.io/settings`.

#### options.secret
Type: `String`
Default value: none
Required

An API secret is required to access Shampoo API. You must be an administrator and you can generate a new key and secret at `http://yourdomain.shampoo.io/settings`.

#### options.query
Type: `String`
Default value: none

The query parameter of the API call to make. Currently, this value is appended to the end of the API call and you may append the URL path and query parameters to this field.

This value could be `single-file` or `single-file?meta=1`.

### Usage Examples

In this example, the common options are set with credentials and shared options. Individual tasks are set with custom options to retrieve content by locale.

```js
grunt.initConfig({
  shampoo: {
    options: {
      domain: "yourdomain",
      type: "dump",
      format: "json",
      key: "yourapikey",
      secret: "yourapisecret"
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
});
```

## About Shampoo

Shampoo is a CMS developed by some folks at Soap Creative, hosted at http://shampoo.io. It is currently in active development.

## Contributing

If you are a user of Shampoo and use this plugin, please contribute and help keep the plugin up to date with the API.

## Release History
_(Initial)_
