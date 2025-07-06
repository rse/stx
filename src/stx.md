
# stx(1) -- Simple Task Execution

## SYNOPSIS

`stx`
\[`-h`|`--help`\]
\[`-V`|`--version`\]
\[`-l`|`--level` *log-level*\]
\[`-v`|`--verbose`\]
\[`-c`|`--config` *config-file*\]
\[`-e`|`--env` *key*`=`*val*\]
\[`-p`|`--prefix` *task-name-prefix*\]
\[`-s`|`--single`\]
\[*task-name* [*task-option* \[...\]\] \[...\]

## DESCRIPTION

`stx`(1), *Simple Task Execution*, is a small command-line tool to run
small scripts to perform certain tasks. It is intended to be used inside
a software build process, especially in one based on *Node Package
Manager (NPM)* scripts. `stx`(1) is inspired by and somewhat resembles
good-old Unix `make`(1), but it is not intended as a direct replacement for it.

## OPTIONS

The following command-line options and arguments exist:

- \[`-h`|`--help`\]:
  Show program usage information only.

- \[`-V`|`--version`\]:
  Show program version information only.

- \[`-l`|`--level *log-level*`\]:
  Set logging verbosity level (`error`, `warning`, `info` or `debug`).
  The default is `warning`.

- \[`-v`|`--version`\]:
  Show executed scripts before execution.

- \[`-c`|`--config` *config-file*\]:
  Use *config-file* for the configuration. The default is the
  relative path `etc/stx.conf` from the current working directory.

- \[`-e`|`--env` *key*`=`*val*\]:
  Extend the process environment with an additional variable of name
  *key* and value *val*. This is for convenience reasons as passing
  environment variables externally is platform and shell specific.

- \[`-p`|`--prefix` *task-name-prefix*\]:
  Prefix all passed *task-name* arguments with *task-name-prefix* before
  trying to execute them. This is for convenience reasons to
  not having to repeat common prefixes of related tasks.

- \[`-s`|`--single`\]:
  Treat all trailing command line arguments after the first *task-name*
  as arguments to a single task. The default is to treat all arguments
  which do not stark with `-` or `+` as separate task names.

- \[*task-name* \[*task-option* \[...\]\] \[...\]
  One or more requests to execute a task named *task-name*
  with zero or more passed options *task-option*. The
  *task-name* has to match the regular expression
  `@?[a-zA-Z_.](?:[a-zA-Z0-9_:.-]+[a-zA-Z0-9_]|[a-zA-Z0-9_]+)`.
  Hence, examples of *task-name* are `foo`, `foo-bar`, `Foo.Bar`,
  `FOO:BAR:QUUX`, etc. The *task-option* has to start with a hyphen
  (`-`). If a command line argument starts with a plus (`+`) this
  prefix is stripped and the argument is NOT treated as a following
  *task-name*, even if option `-s`|`--single` is not enabled.
  The *task-name* arguments are split into segments (separated
  by the regular expression `[_.:-]`) and then each segment is
  matched with multiple strategies: exact match, case-insensite
  match, fuzzy match and prefix match.

## CONFIGURATION

The configuration file of `stx`(1) has to match to the following PEG-style grammar:

```txt
<config>        ::= <empty-line> | <comment-block> | <config-block>

<empty-lines>   ::= /(\s*\r?\n)+/
<comment-block> ::= /(?:#.*?\r?\n)+/
<config-block>  ::= <specification> <script>

<specification> ::= <target>+ (":" <source>+)? <constraint>* <language>?
<script>        ::= /(\s+\S.*?\r?\n)+/

<target>        ::= <task> | <file>
<source>        ::= (<task> | <file>) "?"?
<constraint>    ::= "[" "!"? /.+?/ "]"
<language>      ::= "{" /.+?/ "}"

<task>          ::= <name>
<file>          ::= "@" <name>

<name>          ::= <quoted> | <bareword>

<quoted>        ::= /"((?:\\"|[^\r\n])*)"/
<bareword>      ::= <segment> (<sep> <segment>)*

<segment>       ::= /[a-zA-Z][a-zA-Z0-9]*/
<sep>           ::= /[_.:-]/
```

The configuration structure and semantics are:

- Each configuration consists of one or more configuration blocks,
  each starting with a single non-indented specification line,
  followed by one or more indented script lines.

- Specifications consist of one or more targets, zero
  or more sources, zero or more platform constraints
  and an optional language.

- Targets and sources are either task name definitions and task
  name references or (when prefixed with `@`) output file definitions
  and inputs file references. A source postfix of `?` denotes
  an optional source, which for a task reference means the task
  execution is allowed to fail and for a file reference means
  the file is allowed to not exist.

- Constraints are glob-style matches (optionally negated by a `!` prefix)
  for platforms, formed out of a CPU architecture ("arm", "arm64",
  "ia32", "loong64", "mips", "mipsel", "ppc64", "riscv64", "s390x", and
  "x64" -- see Node.js `process.arch` for details), a separating hypen
  `-`, and operating system name ("aix", "darwin", "freebsd", "linux",
  "openbsd", "sunos", and "win32" -- see Node.js `process.platform`
  for details). Typical examples are: `x64-linux`, `arm64-darwin` and
  `x64-win32`. Constraints act as filters for the configuration blocks:
  if a constraint does not match the current platform, the configuration
  block is silently ignored.

## LANGUAGES

`stx`(1) ships with direct support for the following two built-in programming languages:

- `js`: *JavaScript*, by calling the `node`(1)
  executable `stx`(1) is executed itself. The potential NPM peer
  packages `concurrently`, `shelljs`, `zx`, and `dax-sh` can be
  recommended in order to write platform-agnostic scripts. Use this
  language for maximum scripting flexibility and portability.

- `ts`: *TypeScript*, by calling the `node`(1)
  executable `stx`(1) is executed itself, plus an intermediate `tsx`(1)
  which ships as a dependency to `stx`(1). The potential NPM peer
  packages `concurrently`, `shelljs`, `zx`, and `dax-sh` can be
  recommended in order to write platform-agnostic scripts. Use this
  language for maximum scripting flexibility and portability.

`stx`(1) ships with direct support for the following typical shell languages:

- `shell`: *Shell Abstraction*, by either
  calling `sh`(1) under non-Windows platforms, or calling `cmd` under
  Windows platforms. Additionally, for simple cross-plaform scripting,
  under Windows platforms the following replacements are automatically
  done on the script: line endings are converted to CR-LF,
  line continuations `\\` are converted to `^` and variable references
  like `$XXX` or `${XXX}` are converted to `%XXX%`. If you want
  plain *Bourne-Shell* or *Batch Command*, use the languages
  `sh` and `cmd` instead. Use this language for some scripting
  portability.

- `sh`: *Bourne-Shell*, by calling the `sh`(1) executable.
  This is usually available under non-Windows platforms like
  macOS, Linux, or FreeBSD only. Use this language for
  Unix scripting without portability demands.

- `cmd`: *Batch Command*, by calling the `cmd` executable.
  This is available under Windows platform only. Use this
  language for Windows scripting without portability demands.

Additionally, you can use an arbitrary language as long as a particular
script interpreting program is in `$PATH`. Popular Unix shell examples
are `bash`, `zsh`, `fish`, `nushell`, `xonsh`, or `elvish`. Popular
Windows shell example is `powershell`.

## EXAMPLE

An example configuration is (this is actually the build procedure of `stx`(1) itself):

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

```sh
$ stx
build - build entire project
build:cmd - build command program
build:man - build manual page
build:pkg - build packaging (self-contained executables)
build:watch - code compilation/transpiling (building)
clean - remove regularly built files
clean:dist - remove all built files
lint - static code analysis (linting)
lint:watch - static code analysis (linting) with file watching

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

## HISTORY

`stx`(1) was developed in July 2025 as a replacement for the otherwise
decent `nps`(1) command and to support more complex scripts from within
`npm`(1), the *Node Package Manager (NPM)*. The main issue was that
`nps`(1), when used with YAML and because of special parsing semantics
of YAML, cannot support complex shell scripts with a combination of
line-continuations and indentations.

## AUTHOR

Dr. Ralf S. Engelschall <rse@engelschall.com>
