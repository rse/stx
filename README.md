
<img src="https://raw.githubusercontent.com/rse/stx/master/src/stx-logo.svg" width="300" align="right" alt="" style="z-index: 1000;"/>

stx
===

**Simple Task Execution**

[![github (author stars)](https://img.shields.io/github/stars/rse?logo=github&label=author%20stars&color=%233377aa)](https://github.com/rse)
[![github (author followers)](https://img.shields.io/github/followers/rse?label=author%20followers&logo=github&color=%234477aa)](https://github.com/rse)
<br/>
[![github (project version)](https://img.shields.io/github/package-json/version/rse/stx?logo=github&label=project%20version&color=%234477aa&cacheSeconds=900)](https://github.com/rse/stx)

Abstract
--------

`stx`, *Simple Task Execution*, is a small command-line tool to run
small scripts to perform certain tasks. It is intended to be used inside
a software build process, especially in one based on *Node Package
Manager (NPM)* scripts. `stx` is inspired by and somewhat resembles
good-old Unix `make`, but it is not intended as a direct replacement
for it.

Installation
------------

When you want to use `stx` as a globally available command:

```
$ npm install -g @rse/stx
```

When you want to use `stx` as a locally available build tool from within NPM's `package.json`
by being able to just execute `npm start <task>` instead of `npx stx -v -c etc/stx.conf <task>`:

```
{
    [...]
    "devDependencies": {
        [...]
        "stx": "*"
    },
    "scripts": {
        "start": "stx -v -c etc/stx.conf",
        [...]
    }
}
```

Usage
-----

See the [Unix manual page](src/stx.md) for the documentation of the `stx` command.

## EXAMPLE

See the [STX build procedure](etc/stx.conf) for an example of a STX configuration:

```txt
#   static code analysis (linting)
lint
    eslint --config etc/eslint.mjs src/**/*.ts && \
    markdownlint-cli2 --config etc/.markdownlint.yaml src/**/*.md

#   static code analysis (linting) with file watching
lint:watch
    nodemon --exec "stx lint" --watch src --ext ts

#   code compilation/transpiling (building)
build:watch
    nodemon --exec "stx build" --watch src --ext ts

#   build entire project
build: lint build:cmd build:man

#   build command program
build:cmd
    vite --config etc/vite.mts build --mode production

#   build manual page
build:man
    remark --quiet --use remark-man --output dst-stage2/stx.1 src/stx.md

#   build packaging (self-contained executables)
build:pkg {sh} [!*-win32]
    cd dst-stage2
    rm -f stx-*
    targets="node24-linux-x64,node24-linux-arm64"
    targets="$targets,node24-win-x64,node24-win-arm64"
    targets="$targets,node24-macos-x64,node24-macos-arm64"
    pkg --sea --public -c ../package.json --sea -t "$targets" stx.js
    shx mkdir -p ../dst-stage3
    shx mv stx-linux-x64     ../dst-stage3/stx-lnx-x64     && \
    shx mv stx-linux-arm64   ../dst-stage3/stx-lnx-a64     && \
    shx mv stx-win-x64.exe   ../dst-stage3/stx-win-x64.exe && \
    shx mv stx-win-arm64.exe ../dst-stage3/stx-win-a64.exe && \
    shx mv stx-macos-x64     ../dst-stage3/stx-mac-x64     && \
    shx mv stx-macos-arm64   ../dst-stage3/stx-mac-a64
    stx -h

#   remove regularly built files
clean
    shx rm -rf dst-stage1 dst-stage2 dst-stage3

#   remove all built files
clean:dist : clean
    shx rm -f package-lock.json
    shx rm -rf node_modules
```

Example execution calls are:

```txt
$ stx
Available tasks:
build                     build entire project
build:cmd                 build command program
build:man                 build manual page
build:pkg                 build packaging (self-contained executables)
build:watch               code compilation/transpiling (building)
clean                     remove regularly built files
clean:dist                remove all built files
lint                      static code analysis (linting)
lint:watch                static code analysis (linting) with file watching

$ stx -v build
$ sh [...]
| eslint --config etc/eslint.mjs src/**/*.ts && \
| markdownlint-cli2 --config etc/.markdownlint.yaml src/**/*.md
markdownlint-cli2 v0.18.1 (markdownlint v0.38.0)
Finding: src/**/*.md
Linting: 1 file(s)
Summary: 0 error(s)
$ sh [...]
| vite --config etc/vite.mts build --mode production
vite v7.0.2 building for production...
1:52:32 AM [tsc] building...
1:52:32 AM [tsc] build completed in 447ms.
✓ 1 modules transformed.
dst-stage2/stx.js  10.75 kB
✓ built in 484ms
$ sh [...]
| remark --quiet --use remark-man --output dst-stage2/stx.1 src/stx.md
```

License
-------

Copyright &copy; 2025 Dr. Ralf S. Engelschall (http://engelschall.com/)<br/>
Licensed under [MIT](https://spdx.org/licenses/MIT)

