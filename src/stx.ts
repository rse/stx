/*
**  stx -- Simple Task Execution
**  Copyright (c) 2025 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under MIT <https://spdx.org/licenses/MIT>
*/

/*  external dependencies  */
import path                        from "node:path"
import fs                          from "node:fs"
import os                          from "node:os"
import CLIio                       from "cli-io"
import yargs                       from "yargs"
import stripIndent                 from "strip-indent"
import Tokenizr                    from "tokenizr"
import chalk                       from "chalk"
import { minimatch }               from "minimatch"
import tmp                         from "tmp"
import { execa }                   from "execa"
import { DateTime }                from "luxon"
import * as dice                   from "dice-coefficient"
import levenshtein                 from "fast-levenshtein"

/*  internal dependencies  */
// @ts-ignore
import pkg                         from "../package.json" with { type: "json" }

/*  define task data structure  */
type Task = {
    comment:     string,
    targets:     string[]
    sources:     string[]
    constraints: string[]
    language:    string
    script:      string
}

/*  establish asynchronous environment  */
;(async () => {
    /*  parse command-line arguments  */
    const args = await yargs()
        /* eslint @stylistic/indent: off */
        .version(false)
        .strict()
        .showHelpOnFail(true)
        .demand(0)
        .usage(
            "Usage: $0 " +
            "[-h|--help] " +
            "[-V|--version] " +
            "[-l|--log <logging-level>] " +
            "[-v|--verbose <verbosity-level>] " +
            "[-c|--config <config-file>] " +
            "[-e|--env <key>=<val>] " +
            "[-p|--prefix <task-name-prefix>] " +
            "[-s|--single] " +
            "[<task-name> [<task-option> [...]] " +
            "[...]"
        )
        .help("h").alias("h", "help").default("h", false).describe("h", "show usage help")
        .option("V", {
            alias:    "version",
            type:     "boolean",
            default:  false,
            describe: "show program version information"
        })
        .option("l", {
            alias:    "log",
            type:     "string",
            nargs:    1,
            default:  "warning",
            describe: "set logging level for showing execution information ('error', 'warning', 'info', 'debug')"
        })
        .option("v", {
            alias:    "verbose",
            type:     "number",
            default:  0,
            describe: "set verbosity level for showing script information (0-4)"
        })
        .option("c", {
            alias:    "config",
            type:     "string",
            nargs:    1,
            default:  "etc/stx.conf",
            describe: "path to the configuration file"
        })
        .option("e", {
            alias:    "env",
            type:     "string",
            array:    true,
            nargs:    1,
            default:  [] as string[],
            describe: "set environment variable for executed scripts"
        })
        .option("p", {
            alias:    "prefix",
            type:     "string",
            default:  "",
            describe: "prefix all task names before calling"
        })
        .option("s", {
            alias:    "single",
            type:     "boolean",
            default:  false,
            describe: "pass all arguments to a single task"
        })
        .parserConfiguration({ "halt-at-non-option": true })
        .parse(process.argv.slice(2))

    /*  short-circuit version request  */
    if (args.V) {
        process.stderr.write(`stx ${pkg.version} <${pkg.homepage}>\n`)
        process.stderr.write(`Copyright (c) 2025 ${pkg.author.name} <${pkg.author.url}>\n`)
        process.stderr.write(`Licensed under ${pkg.license} <http://spdx.org/licenses/${pkg.license}.html>\n`)
        process.exit(0)
    }

    /*  establish CLI environment  */
    const cli = new CLIio({
        encoding:  "utf8",
        logLevel:  args.l,
        logTime:   false,
        logPrefix: "stx"
    })

    /*  read configuration  */
    cli.log("info", `reading task configuration file "${chalk.blue(args.c)}"`)
    const conf = await fs.promises.readFile(args.c, "utf8").catch(() => {
        cli.log("error", `failed to read task configuration file "${args.c}"`)
        process.exit(1)
    })

    /*  define token-based parser  */
    const re = (strings: TemplateStringsArray, ...values: any[]) =>
        new RegExp(String.raw(strings, ...values))
    const lexer  = new Tokenizr()
    const seg    = "[a-zA-Z][a-zA-Z0-9]*"
    const sep    = "[_.:-]"
    const nl     = "\\r?\\n"
    const ws     = "[ \\t]"
    const nonl   = "[^\\r\\n]"
    const nowsnl = "[^ \\t\\r\\n]"
    const name   = `${seg}(?:${sep}${seg})*`
    const any    = `(?:.|${nl})`
    lexer.rule("default", re`#+${ws}*(${nonl}*)`, (ctx, match) => {
        ctx.accept("comment", match[1])
    })
    lexer.rule("default", re`${nowsnl}+`, (ctx, match) => {
        ctx.state("target")
        ctx.repeat()
    })
    lexer.rule("default", re`${ws}*${nl}`, (ctx, match) => {
        ctx.ignore()
    })
    lexer.rule("target,source", re`"((?:\\"|${nonl})*)"`, (ctx, match) => {
        ctx.accept(lexer.state(), match[1].replace(/\\"/g, "\""))
    })
    lexer.rule("source", re`@?${name}\??`, (ctx, match) => {
        ctx.accept(lexer.state())
    })
    lexer.rule("target,source", re`@?${name}`, (ctx, match) => {
        ctx.accept(lexer.state())
    })
    lexer.rule("target,source", re`\[(!?${nonl}+?)\]`, (ctx, match) => {
        ctx.accept("constraint", match[1])
    })
    lexer.rule("target,source", re`\{(${nonl}+?)\}`, (ctx, match) => {
        ctx.accept("language", match[1])
    })
    lexer.rule("target", re`${ws}*:${ws}*`, (ctx, match) => {
        ctx.ignore()
        ctx.state("source")
    })
    lexer.rule("target,source", re`${ws}+`, (ctx, match) => {
        ctx.ignore()
    })
    lexer.rule("target,source", re`${nl}`, (ctx, match) => {
        ctx.state("script")
        ctx.ignore()
    })
    const scrRegLn = `${ws}+${nonl}*${nl}`
    const scrEmpLn = `${ws}*${nl}`
    lexer.rule("script", re`${scrRegLn}+(?:(?:${scrRegLn}|${scrEmpLn})*${scrRegLn})?`, (ctx, match) => {
        ctx.accept("script")
        ctx.state("default")
    })
    lexer.rule("script", re`${any}`, (ctx, match) => {
        ctx.state("default")
        ctx.repeat()
    })
    lexer.rule("*", re`${any}`, (ctx, match) => {
        ctx.reject()
    })

    /*  parse configuration  */
    const tasks: Task[] = []
    let n = 0
    lexer.input(conf)
    lexer.debug(false)
    lexer.state("default")
    const currentTask = () => {
        if (tasks[n] === undefined) {
            tasks[n] = {
                comment:     "",
                targets:     [],
                sources:     [],
                constraints: [],
                language:    "",
                script:      ""
            } as Task
        }
        return tasks[n]
    }
    let lastComment = ""
    lexer.tokens().forEach((token) => {
        cli.log("debug", `parsing token: type: "${token.type}", value: "${token.value}"`)
        if (token.type === "comment")
            lastComment = token.value
        else if (token.type === "target") {
            const task = currentTask()
            if (lastComment !== "")
                task.comment = lastComment
            lastComment = ""
            task.targets.push(token.value)
        }
        else if (token.type === "source") {
            const task = currentTask()
            task.sources.push(token.value)
        }
        else if (token.type === "constraint") {
            const task = currentTask()
            task.constraints.push(token.value)
        }
        else if (token.type === "language") {
            const task = currentTask()
            task.language = token.value
        }
        else if (token.type === "script") {
            if (token.value !== null) {
                const task = currentTask()
                let script = stripIndent(token.value)
                script = script.replaceAll(/\r\n/g, "\n")
                script = script.replace(/^\n+/, "")
                script = script.replace(/\n{2,}$/, "\n")
                task.script = script
            }
            n++
        }
        else if (token.type !== "EOF")
            throw new Error(`invalid token: ${token.type} ("${token.text}")`)
    })

    /*  retrieve system information  */
    const sysInfo = (name: string) => {
        let value = ""
        if      (name === "machine")  value = os.machine()
        else if (name === "platform") value = os.platform()
        else if (name === "hostname") value = os.hostname()
        return value
    }

    /*  index tasks by target  */
    const targets = new Map<string, Task>()
    for (const task of tasks) {
        cli.log("debug", `task: targets: ${JSON.stringify(task.targets)}` +
            `, sources: ${JSON.stringify(task.sources)}` +
            `, constraints: ${JSON.stringify(task.constraints)}` +
            `, language: "${task.language}"` +
            `, comment: "${task.comment}"` +
            `, script: ${JSON.stringify(task.script)}`)

        /*  check constraints  */
        let skip = false
        for (const constraint of task.constraints) {
            const m = constraint.match(/^(.+?)=(!)?(.+)$/)
            if (m === null)
                throw new Error(`invalid constraint: "${constraint}"`)
            const name    = m[1]
            const negated = !!m[2]
            const value   = m[3]
            const matches = minimatch(sysInfo(name), value)
            if ((!matches && !negated) || (matches && negated)) {
                skip = true
                break
            }
        }
        if (skip)
            continue

        /*  index targets  */
        for (const target of task.targets) {
            if (targets.has(target))
                throw new Error(`target ${chalk.blue(target)} defined multiple times`)
            targets.set(target, task)
        }
    }

    /*  sanity check source tasks  */
    for (const task of tasks) {
        for (let source of task.sources) {
            const m = source.match(/^(.+?)\?$/)
            if (m !== null)
                source = m[1]
            if (source.match(/^@(.+)$/) === null)
                if (!targets.has(source))
                    throw new Error(`source task "${source}" not defined as a target`)
        }
    }

    /*  ensure a graceful cleanup of temporary files  */
    tmp.setGracefulCleanup()
    const tempfile = (ext: string) => {
        return new Promise<{ path: string, fd: number }>((resolve, reject) => {
            tmp.file({ mode: 0o600, prefix: "stx-", postfix: `.${ext}` }, (err, path, fd) => {
                if (err)
                    reject(err)
                else
                    resolve({ path, fd })
            })
        })
    }

    /*  perform requested operation...  */
    if (args._.length === 0) {
        /*  list all available targets  */
        process.stdout.write("Available tasks:\n")
        for (const key of targets.keys().toArray().sort()) {
            if (targets.get(key)!.comment !== "") {
                const left  = key.padEnd(25, " ")
                const right = targets.get(key)!.comment
                process.stdout.write(`${chalk.blue(left)} ${chalk.grey(right)}\n`)
            }
            else
                process.stdout.write(`${chalk.blue(key)}\n`)
        }
    }
    else {
        /*  execute single target  */
        const executeTask = async (target: string, taskArgs: string[], seen = new Set<string>()): Promise<number> => {
            /*  stop potential recursion loops  */
            if (seen.has(target))
                return 0
            seen.add(target)

            /*  determine task  */
            if (!targets.has(target))
                throw new Error(`task target "${target}" not defined`)
            const task = targets.get(target)!

            /*  check or execute sources  */
            let sourcesOlderFiles = 0
            let targetDate = DateTime.now().toUnixInteger()
            const m = target.match(/^@(.+)$/)
            if (m !== null) {
                const [ , file ] = m
                const stat = await fs.promises.stat(file).catch(() => null)
                if (stat !== null)
                    targetDate = DateTime.fromJSDate(stat.mtime).toUnixInteger()
            }
            for (let source of task.sources) {
                let optional = false
                let m = source.match(/^(.+?)\?$/)
                if (m !== null) {
                    source   = m[1]
                    optional = true
                }
                m = source.match(/^@(.+)$/)
                if (m !== null) {
                    const file = m[1]
                    const stat = await fs.promises.stat(file).catch(() => null)
                    const sourceDate = stat !== null ? DateTime.fromJSDate(stat.mtime).toUnixInteger() : 0
                    if (targetDate > sourceDate) {
                        if (targets.has(source)) {
                            sourcesOlderFiles++
                            const exitCode = await executeTask(source, [], seen) /* RECURSION */
                            if (exitCode !== 0 && !optional)
                                return exitCode
                        }
                        else if (stat !== null)
                            sourcesOlderFiles++
                        else if (stat === null && !optional)
                            throw new Error(`mandatory source file "${chalk.red(source)}" not found`)
                    }
                }
                else {
                    const exitCode = await executeTask(source, [], seen) /* RECURSION */
                    if (exitCode !== 0 && !optional)
                        return exitCode
                }
            }
            if (task.sources.length > 0 && task.sources.length === sourcesOlderFiles) {
                cli.log("info", `task <${chalk.blue(target)}> still up-to-date`)
                return 0
            }

            /*  helper function: quote a command  */
            const quotedCommand = (argv: string[]) => {
                return argv.map((a) => {
                    if (a.match(/\s/))
                        a = `"${a.replaceAll(/"/g, "\\\"")}"`
                    return a
                }).join(" ")
            }

            /*  give information about our operation  */
            let info = `task <${chalk.blue(target)}>`
            if (taskArgs.length > 0)
                info += ` [${chalk.blue(quotedCommand(taskArgs))}]`
            if (task.comment !== "")
                info += chalk.grey(` "${task.comment}"`)
            if (task.script === "")
                info += " is fulfilled"
            else
                info += " is executed"
            cli.log("info", info)

            /*  short-circuit processing if script is empty  */
            if (task.script === "")
                return 0

            /*  helper function for finding NODE_PATH  */
            const getNodePath = () => {
                let path = ""
                for (const dir of module.paths) {
                    if (path !== "")
                        path += (process.platform === "win32" ? ";" : ":")
                    path += dir
                }
                return path
            }
            const extendPath = async (p: string) => {
                for (const dir of module.paths.reverse()) {
                    const bindir = path.join(dir, ".bin")
                    const stat = await fs.promises.stat(bindir).catch(() => null)
                    if (stat !== null && stat.isDirectory()) {
                        if (p !== "")
                            p = `${process.platform === "win32" ? ";" : ":"}${p}`
                        p = `${path.join(dir, ".bin")}${p}`
                    }
                }
                return p
            }

            /*  determine language and script  */
            let cmd = "shell"
            let av  = [] as string[]
            let ext = ""
            const env = { ...process.env } as { [ key: string ]: string }
            if (task.language === "js") {
                /*  JavaScript via Node (always available)  */
                cmd = process.execPath
                env.NODE_PATH = getNodePath()
                ext = "js"
            }
            else if (task.language === "ts") {
                /*  TypeScript via Node/TSX (always available)  */
                cmd = process.execPath
                env.NODE_PATH = getNodePath()
                const tsx = path.join(__dirname, "../node_modules/.bin/tsx")
                av  = [ tsx ]
                ext = "ts"
            }
            else if (task.language === "sh") {
                /*  Bourne-Shell (Unix only)  */
                cmd = "sh"
                ext = "sh"
            }
            else if (task.language === "cmd") {
                /*  Microsoft Windows Batch (Windows only)  */
                cmd = "cmd"
                av  = [ "/c" ]
                ext = "bat"
            }
            else if (task.language !== "" && task.language !== cmd) {
                /*  custom language  */
                cmd = task.language
                ext = task.language
            }

            /*  support a mostly platform-agnostic shell script
                (mostly for very simple scripts which just call commands)  */
            let script = task.script
            if (cmd === "shell") {
                cmd = process.platform === "win32" ? "cmd" : "sh"
                av  = process.platform === "win32" ? [ "/c" ] : []
                ext = process.platform === "win32" ? "bat" : "sh"
                if (process.platform === "win32") {
                    script = script.replaceAll(/\r?\n/g, "\r\n")
                    script = script.replaceAll(/\\\r\n/g, "^\r\n")
                    script = script.replaceAll(/$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, "%$1%")
                    script = script.replaceAll(/$([a-zA-Z_][a-zA-Z0-9_]*)/g, "%$1%")
                }
                else
                    script = script.replaceAll(/\r?\n/g, "\n")
            }

            /*  create script file  */
            const file = await tempfile(ext)
            await fs.promises.writeFile(file.path, script, "utf8")
            const quoted = quotedCommand([ cmd, ...av, file.path ])
            if (taskArgs.length > 0) {
                const args = quotedCommand(taskArgs)
                cli.log("info", `command: ${chalk.blue(quoted)}, args: ${chalk.blue(args)}`)
            }
            else
                cli.log("info", `command: ${chalk.blue(quoted)}`)
            for (const line of script.split("\n").slice(0, -1))
                cli.log("debug", `| ${chalk.blue(line)}`)

            /*  optionally show script information  */
            if (args.v >= 4)
                process.stderr.write(`${chalk.grey("_".repeat(78))}\n`)
            if (args.v >= 3 && task.comment !== "")
                process.stderr.write(`${chalk.grey.italic.inverse("  " + task.comment + "  ")}\n`)
            if (args.v >= 2) {
                const argv = quotedCommand(taskArgs)
                process.stderr.write(`${chalk.grey("$")} ${chalk.blue(cmd)} ` +
                    `${chalk.grey("[...]")} ${argv !== "" ? chalk.blue(argv) : ""}\n`)
            }
            if (args.v >= 1)
                for (const line of script.split("\n").slice(0, -1))
                    process.stderr.write(`${chalk.grey("| ")}${chalk.blue(line)}\n`)

            /*  extend environment  */
            env.PATH = await extendPath(env.PATH ?? env.Path)
            env.STX_CMD  = quotedCommand([ cmd, ...av, file.path ])
            env.STX_ARGS = quotedCommand(taskArgs)
            for (const e of args.e) {
                const m = e.match(/^(.+?)=(.+)$/)
                if (m !== null) {
                    const [ , key, val ] = m
                    env[key] = val
                }
                else
                    env[e] = "1"
            }

            /*  execute script file  */
            const result = await execa(cmd, [ ...av, file.path, ...taskArgs ], {
                stdio: [ "inherit", "inherit", "inherit" ],
                reject: false,
                env
            })
            if (result.failed) {
                if (result.isTerminated) {
                    cli.log("error", `task <${chalk.blue(target)}> terminated with signal ${chalk.red(result.signal)}`)
                    return -1
                }
                else if (result.exitCode !== 0) {
                    cli.log("error", `task <${chalk.blue(target)}> terminated with non-zero exit code ${chalk.red(result.exitCode)}`)
                    return result.exitCode!
                }
                else if (result.code !== "") {
                    cli.log("error", `task <${chalk.blue(target)}> terminated with error code ${chalk.red(result.code)} (${result.originalMessage})`)
                    return result.exitCode!
                }
                else {
                    cli.log("error", `task <${chalk.blue(target)}> terminated for unknown reasons`)
                    return -1
                }
            }
            return 0
        }

        /*  execute single target (through fuzzy matching)  */
        const executeTaskFuzzy = async (taskName: string, taskArgs: string[]): Promise<number> => {
            /*  optionally prefix the task name  */
            if (args.p !== "")
                taskName = args.p + taskName

            /*  determine requested target  */
            if (!targets.has(taskName)) {
                /*  try to match the task name  */
                /* eslint @stylistic/object-curly-newline: off */
                const strategies = [
                    /*  exact match  */
                    { name: "exact match", cb: (request: string, given: string) => {
                        return request === given
                    } },

                    /*  case-insensitive match  */
                    { name: "case-insensitive match", cb: (request: string, given: string) => {
                        return request.toLowerCase() === given.toLowerCase()
                    } },

                    /*  fuzzy match  */
                    { name: "fuzzy match", cb: (request: string, given: string) => {
                        return (
                            Math.abs(request.length - given.length) <= 1
                            && (
                                dice.diceCoefficient(request, given) >= 0.50
                                || levenshtein.get(request, given) <= 2
                            )
                        )
                    } },

                    /*  prefix match  */
                    { name: "prefix match", cb: (request: string, given: string) => {
                        return given.indexOf(request) === 0
                    } },

                    /*  case-insensitive prefix match  */
                    { name: "case-insensitive prefix match", cb: (request: string, given: string) => {
                        return given.toLowerCase().indexOf(request.toLowerCase()) === 0
                    } }
                ]

                /*  pre-determine the name segments  */
                const segsRequested = taskName.split(/[^a-zA-Z0-9]+/)
                const segsGivenAll  = targets.keys().toArray().sort()
                    .map((name) => ({ name, segs: name.split(/[^a-zA-Z0-9]+/) }))

                /*  for all given targets and their segments...  */
                const taskNameExpanded = []
                for (const target of segsGivenAll) {
                    const segsGiven = target.segs

                    /*  if the number of segments is equal...  */
                    if (segsRequested.length === segsGiven.length) {
                        /*  for all segments...  */
                        let allSegmentsMatch = true
                        for (let i = 0; i < segsRequested.length; i++) {
                            /*  for all matching strategies...  */
                            let anyStrategyMatch = false
                            for (const matcher of strategies) {
                                /*  if the segment matches...  */
                                if (matcher.cb(segsRequested[i], segsGiven[i])) {
                                    anyStrategyMatch = true
                                    break
                                }
                            }
                            if (!anyStrategyMatch) {
                                allSegmentsMatch = false
                                break
                            }
                        }
                        if (allSegmentsMatch)
                            /*  remember expanded task name  */
                            taskNameExpanded.push(target.name)
                    }
                }
                if (taskNameExpanded.length === 0) {
                    cli.log("error", `task request "${chalk.red(taskName)}" does not match any task`)
                    return -1
                }
                else if (taskNameExpanded.length > 1) {
                    const tasks = taskNameExpanded.sort().map((t) => `<${chalk.blue(t)}>`).join(", ")
                    cli.log("error", `task request "${chalk.red(taskName)}" ambiguously matches more than one task: ${tasks}`)
                    return -1
                }
                else if (taskNameExpanded[0] !== taskName) {
                    cli.log("info", `task request "${chalk.red(taskName)}" expanded to task <${chalk.blue(taskNameExpanded[0])}>`)
                    taskName = taskNameExpanded[0]
                }
            }

            /*  execute the requested target  */
            const exitCode = await executeTask(taskName, taskArgs)
            return exitCode
        }

        /*  execute requested tasks  */
        let exitCode = 0
        if (args.s) {
            /*  execute single task  */
            const taskName = String(args._[0])
            const taskArgs = args._.slice(1).map((arg) => String(arg))
            exitCode = await executeTaskFuzzy(taskName, taskArgs)
        }
        else {
            /*  execute potentially multiple tasks  */
            let argvTask = [] as string[]
            const argvAll = args._.map((a) => String(a))
            const flush = async () => {
                let exitCode = 0
                if (argvTask.length > 0) {
                    const taskName = argvTask[0]
                    const taskArgs = argvTask.slice(1)
                    exitCode = await executeTaskFuzzy(taskName, taskArgs)
                    argvTask = [] as string[]
                }
                return exitCode
            }
            for (let i = 0; i < argvAll.length; i++) {
                if (i > 0 && argvAll[i].match(/^[-+].+/) === null) {
                    exitCode = await flush()
                    if (exitCode !== 0)
                        break
                }
                const m = argvAll[i].match(/^\+(.+)$/)
                if (m !== null)
                    argvTask.push(m[1])
                else
                    argvTask.push(argvAll[i])
            }
            if (exitCode === 0)
                exitCode = await flush()
        }

        /*  pass-through exit code to outer shell  */
        process.exit(exitCode)
    }
})().catch((err) => {
    /*  catch fatal run-time errors  */
    process.stderr.write(`stx: ${chalk.red("ERROR:")} ${err}\n`)
    process.exit(1)
})

