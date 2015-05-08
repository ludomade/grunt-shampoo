# shampoo

> A grunt plugin to grab the data down from Ludomade's shampoo app.

## Getting Started
This plugin requires Grunt `~0.4.5`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install shampoo --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('shampoo');
```

## The "shampoo" task

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

The document ID which you want to pull data down from.  To find your document ID, open your shampoo document in the browser.  The document ID is displayed in the URL, after /#/edit/.  For example: /#/edit/{documentId}.

#### options.activeLocales
Type: `Array<String>`
Default value: ``

Enter an array of strings of locales you wish to pull down.  Ie, ['en-US', 'en-GB', 'en-AU'].  The locale codes must match the code setup within shampoo.

### Usage Examples

#### Default Options
In this example, shampoo will grab the document with the ID of 0B0DrlaR4h0bLYjlxaF9ZNzZuZEU, and pull down the en-US and fr-FR locales when invoked via `grunt shampoo`.

```js
grunt.initConfig({
  shampoo: {
    documentId: "0B0DrlaR4h0bLYjlxaF9ZNzZuZEU",
    activeLocales: ["en-US", "fr-FR"]
  },
});
```

### Task arguments

If you want to pull down only a specific locale, pass in the locale code as an argument to the shampoo task to pull down just that specific locale.

For example:

`grunt shampoo:es-MX` would pull down just the es-MX locale.  The list of locales setup in the activeLocales options set in the grunt initConfig object will be ignored.