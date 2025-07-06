
<img src="https://raw.githubusercontent.com/rse/stx/master/src/stx-logo.svg" width="200" align="right" alt=""/>

stx
===

**Simple Task Execution**

[![github (author stars)](https://img.shields.io/github/stars/rse?logo=github&label=author%20stars&color=%233377aa)](https://github.com/rse)
[![github (author followers)](https://img.shields.io/github/followers/rse?label=author%20followers&logo=github&color=%234477aa)](https://github.com/rse)
[![github (project stdver)](https://img.shields.io/github/package-json/stdver/rse/rundown?logo=github&label=project%20stdver&color=%234477aa&cacheSeconds=900)](https://github.com/rse/rundown)

Abstract
--------

`stx`(1), *Simple Task Execution*, is a small command-line tool to run
small scripts to perform certain tasks. It is intended to be used inside
a software build process, especially in one based on *Node Package
Manager (NPM)* scripts. `stx`(1) is inspired by and somewhat resembles
good-old Unix `make`(1), but it is not intended as a direct replacement
for it.

Installation
------------

```
$ npm install [-g] stx
```

Usage
-----

See the [Unix manual page](src/stx.md) for the documentation of the `stx`(1) command.
See the [STX build procedure](etc/stx.conf) for an example of a STX configuration.

License
-------

Copyright &copy; 2025 Dr. Ralf S. Engelschall (http://engelschall.com/)<br/>
Licensed under [MIT](https://spdx.org/licenses/MIT)

