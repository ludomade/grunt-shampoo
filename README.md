# grunt-shampoo

> A grunt plugin to retrieve data from Ludomade's Shampoo app.

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

## Configuration

This plugin requires a file named `.shampoo` that lives in the same directory as your gruntfile. Copy the provided `.shampoo.example`, and rename it to `.shampoo`.

Fill in the Google client id and Google client secret that's provided in the Shampoo configuration located in the [google developer console](https://console.developers.google.com/project).

If you have no idea what these items are, contact a Shampoo developer who can provide you with a valid `.shampoo` file.

IMPORTANT - always include `.shampoo` in your `.gitignore`. This file is never meant to be passed around.

## The `grunt-shampoo` task

### Overview

In your project's Gruntfile, add a section named `shampoo` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  shampoo: {
    options: {
      documentId: "" //Your shampoo document ID (grab this from the shampoo URL),
      activeLocales: []
    },
  },
});
```

### Options

#### options.documentId
Type: `String`
Default value: ``

The document ID which you want to pull data down from.  To find your document ID, open your Shampoo document in the browser.  The document ID is displayed in the URL, after `/#/edit/`.  For example: `/#/edit/{documentId}`.

#### options.activeLocales
Type: `Array<String>`
Default value: ``

Enter an array of strings of locales you wish to pull down.  Ie, `['en-US', 'en-GB', 'en-AU']`.  The locale codes must match the code setup within Shampoo.

### Usage Examples

#### Default Options

In this example, Shampoo will grab the document with the ID of `0B0DrlaR4h0bLYjlxaF9ZNzZuZEU`, and pull down the `en-US` and `fr-FR` locales when invoked via `grunt shampoo`.

```js
grunt.initConfig({
  shampoo: {
    documentId: "0B0DrlaR4h0bLYjlxaF9ZNzZuZEU",
    activeLocales: ["en-US", "fr-FR"]
  },
});
```

### Task arguments

If you want to pull down only a specific locale, pass in the locale code as an argument to the Shampoo task to pull down just that specific locale.

For example:

`grunt shampoo:es-MX` would pull down just the `es-MX` locale.  The list of locales setup in the `activeLocales` options set in the grunt `initConfig` object will be ignored.
