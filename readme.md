# package-yaml

This builds on [@reggi](https://github.com/reggi)'s [`package-yml`](https://github.com/reggi/package-yml), which itself is on the shoulders of the work of [@saschagehlich](https://github.com/saschagehlich) and the [`npm-yaml`](https://github.com/saschagehlich/npm-yaml) project. In an effort to use `yaml` instead of `json` for npm's package file, while still retaining compatibility with legacy tools.

## Install

The recommended installation is to install `npm-autoloader` globally, and add `package-yaml` as a devDependency of your project:

```bash
# If npm-autoloader is not already installed:
npm install npm-autoloader --global
npm config set onload-script npm-autoloader --global

# To install package-yaml for this project:
npm install package-yaml --save-dev
echo "- package-yaml" >> npm-autoload.json
```

Alternately, you can install package-yaml globally on its own:

```bash
npm install package-yaml --global
npm config set onload-script package-yaml
```

Or, less portably, manually in a package-local setting:

```bash
npm install package-yaml --save-dev
echo "onload-script=$PWD/node_modules/package-yaml" >> .npmrc
```

## Why

It's easier to read and write `yaml` over `json`.

## How

Every time you run an `npm` command `package-yaml` will check for a `yaml` file. If one exists it will update the existing `json` file with the contents. When the `npm` process exists the contents from the `json` will update the `yaml` file.

---

Copyright (c) 2014 Thomas Reggi, 2019 Danielle Church

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
