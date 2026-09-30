/*
**  stx -- Simple Task Execution
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under MIT <https://spdx.org/licenses/MIT>
*/

/*  external dependencies  */
import path                        from "node:path"
import fs                          from "node:fs"
import os                          from "node:os"
import CLIio                       from "cli-io"
import yargs                       from "yargs"
import stripIndent                 from "strip-indent"
import { Tokenizr }                from "tokenizr"
import chalk                       from "chalk"
import { minimatch }               from "minimatch"
import tmp                         from "tmp"
import { execa }                   from "execa"
import * as dice                   from "dice-coefficient"
import levenshtein                 from "fast-levenshtein"

/*  internal dependencies  */
// @ts-ignore
import pkg                         from "../package.json" with { type: "json" }

/*  define task data structure  */
type Task = {
    comment:     string
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
            "[<task-name> [<task-option> [...]]] " +
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
            nargs:    1,
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
        process.stderr.write(`Copyright (c) 2025-2026 ${pkg.author.name} <${pkg.author.url}>\n`)
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
    const conf = await fs.promises.readFile(args.c, "utf8").catch((err) => {
        cli.log("error", `failed to read task configuration file "${args.c}": ${err}`)
        process.exit(1)
    })

    /*  define token-based parser  */
    const re = (strings: TemplateStringsArray, ...values: unknown[]) =>
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
    lexer.rule("default", re`${nowsnl}+`, (ctx) => {
        ctx.state("target")
        ctx.repeat()
    })
    lexer.rule("default", re`${ws}*${nl}`, (ctx) => {
        ctx.ignore()
    })
    lexer.rule("target,source", re`"((?:\\"|${nonl})*)"`, (ctx, match) => {
        ctx.accept(lexer.state(), match[1].replace(/\\"/g, "\""))
    })
    lexer.rule("source", re`@?${name}\??`, (ctx) => {
        ctx.accept(lexer.state())
    })
    lexer.rule("target,source", re`@?${name}`, (ctx) => {
        ctx.accept(lexer.state())
    })
    lexer.rule("target,source", re`\[(!?${nonl}+?)\]`, (ctx, match) => {
        ctx.accept("constraint", match[1])
    })
    lexer.rule("target,source", re`\{(${nonl}+?)\}`, (ctx, match) => {
        ctx.accept("language", match[1])
    })
    lexer.rule("target", re`${ws}*:${ws}*`, (ctx) => {
        ctx.ignore()
        ctx.state("source")
    })
    lexer.rule("target,source", re`${ws}+`, (ctx) => {
        ctx.ignore()
    })
    lexer.rule("target,source", re`${nl}`, (ctx) => {
        ctx.state("script")
        ctx.ignore()
    })
    const scrRegLn = `${ws}+${nonl}*${nl}`
    const scrEmpLn = `${ws}*${nl}`
    lexer.rule("script", re`${scrRegLn}+(?:(?:${scrRegLn}|${scrEmpLn})*${scrRegLn})?`, (ctx, match) => {
        ctx.accept("script", match[0])
        ctx.state("default")
    })
    lexer.rule("script", re`${any}`, (ctx) => {
        ctx.state("default")
        ctx.repeat()
    })
    lexer.rule("*", re`${any}`, (ctx) => {
        ctx.reject()
    })

    /*  parse configuration  */
    const tasks: Task[] = []
    let taskIndex = 0
    lexer.input(conf)
    lexer.debug(false)
    lexer.state("default")

    /*  helper function: get or lazily create the current task  */
    const currentTask = () => {
        if (tasks[taskIndex] === undefined) {
            tasks[taskIndex] = {
                comment:     "",
                targets:     [],
                sources:     [],
                constraints: [],
                language:    "",
                script:      ""
            } satisfies Task
        }
        return tasks[taskIndex]
    }
    let lastComment = ""
    lexer.tokens().forEach((token) => {
        cli.log("debug", `parsing token: type: "${token.type}", value: "${token.value}"`)
        if (token.type === "comment")
            lastComment = token.value as string
        else if (token.type === "target") {
            let task = currentTask()
            if (task.sources.length > 0 || task.constraints.length > 0 || task.language !== "") {
                taskIndex++
                task = currentTask()
            }
            if (lastComment !== "")
                task.comment = lastComment
            lastComment = ""
            task.targets.push(token.value as string)
        }
        else if (token.type === "source") {
            const task = currentTask()
            task.sources.push(token.value as string)
        }
        else if (token.type === "constraint") {
            const task = currentTask()
            task.constraints.push(token.value as string)
        }
        else if (token.type === "language") {
            const task = currentTask()
            task.language = token.value as string
        }
        else if (token.type === "script") {
            const task = currentTask()
            let script = stripIndent(token.value as string)
            script = script.replaceAll(/\r\n/g, "\n")
            script = script.replace(/^\n+/, "")
            script = script.replace(/\n{2,}$/, "\n")
            task.script = script
            taskIndex++
        }
        else if (token.type !== "EOF")
            throw new Error(`invalid token: ${token.type} ("${token.text}")`)
    })

    /*  retrieve system information  */
    const sysInfo = (name: string) => {
        if      (name === "machine")  return os.machine()
        else if (name === "platform") return os.platform()
        else if (name === "hostname") return os.hostname()
        else throw new Error(`invalid constraint key: "${name}"`)
    }

    /*  index tasks by target  */
    const targets = new Map<string, Task>()
    const tasksActive: Task[] = []
    for (const task of tasks) {
        cli.log("debug", `task: targets: ${JSON.stringify(task.targets)}` +
            `, sources: ${JSON.stringify(task.sources)}` +
            `, constraints: ${JSON.stringify(task.constraints)}` +
            `, language: "${task.language}"` +
            `, comment: "${task.comment}"` +
            `, script: ${JSON.stringify(task.script)}`)

        /*  check constraints  */
        const skip = task.constraints.some((constraint) => {
            const m = constraint.match(/^(!)?(.+?)=(!)?(.+)$/)
            if (m === null)
                throw new Error(`invalid constraint: "${constraint}"`)
            const key     = m[2]
            const negated = !!m[1] !== !!m[3]
            const value   = m[4]
            return minimatch(sysInfo(key), value) === negated
        })
        if (skip)
            continue
        tasksActive.push(task)

        /*  index targets  */
        for (const target of task.targets) {
            if (targets.has(target))
                throw new Error(`target ${chalk.blue(target)} defined multiple times`)
            targets.set(target, task)
        }
    }

    /*  sanity check source tasks  */
    for (const task of tasksActive) {
        for (const source of task.sources) {
            const ref = source.replace(/\?$/, "")
            if (!ref.startsWith("@") && !targets.has(ref))
                throw new Error(`source task "${ref}" not defined as a target`)
        }
    }

    /*  ensure a graceful cleanup of temporary files
        (also on signal-caused terminations, where Node does not emit the
        "exit" event the "tmp" module hooks its garbage collection into)  */
    tmp.setGracefulCleanup()
    for (const signal of [ "SIGINT", "SIGTERM", "SIGHUP" ] as const)
        process.on(signal, () =>
            process.exit(128 + os.constants.signals[signal]))

    /*  helper function: create a temporary file  */
    const tempfile = (ext: string) => {
        return new Promise<{ path: string, remove: () => void }>((resolve, reject) => {
            tmp.file({ mode: 0o600, prefix: "stx-", postfix: `.${ext}`, discardDescriptor: true }, (err, name, _fd, remove) => {
                if (err)
                    reject(err)
                else
                    resolve({ path: name, remove })
            })
        })
    }

    /*  perform requested operation...  */
    if (args._.length === 0) {
        /*  list all available targets  */
        process.stdout.write("Available tasks:\n")
        for (const key of targets.keys().toArray().sort()) {
            const task = targets.get(key)!
            if (task.comment !== "") {
                const left  = key.padEnd(25, " ")
                const right = task.comment
                process.stdout.write(`${chalk.blue(left)} ${chalk.grey(right)}\n`)
            }
            else
                process.stdout.write(`${chalk.blue(key)}\n`)
        }
    }
    else {
        /*  helper function: quote a command  */
        const quotedCommand = (argv: string[]) =>
            argv.map((a) => (a === "" || /[\s"]/.test(a)) ? `"${a.replaceAll("\"", "\\\"")}"` : a).join(" ")

        /*  helper functions for determining NODE_PATH and extending PATH  */
        const getNodePath = () => {
            return module.paths.join(path.delimiter)
        }
        const extendPath = async (p: string) => {
            for (const dir of module.paths.toReversed()) {
                const bindir = path.join(dir, ".bin")
                const stat = await fs.promises.stat(bindir).catch(() => null)
                if (stat !== null && stat.isDirectory()) {
                    if (p !== "")
                        p = `${path.delimiter}${p}`
                    p = `${bindir}${p}`
                }
            }
            return p
        }

        /*  execute single target  */
        const executeTask = async (target: string, taskArgs: string[], seen = new Set<string>()): Promise<number> => {
            /*  stop potential recursion loops  */
            if (seen.has(target))
                return 0
            seen.add(target)

            /*  determine task  */
            const task = targets.get(target)
            if (task === undefined)
                throw new Error(`task target "${target}" not defined`)

            /*  check or execute sources  */
            let sourcesOlderFiles = 0
            let targetDate = 0
            if (target.startsWith("@")) {
                const stat = await fs.promises.stat(target.slice(1)).catch(() => null)
                if (stat !== null)
                    targetDate = stat.mtimeMs
            }
            for (const spec of task.sources) {
                const optional = spec.endsWith("?")
                const source   = optional ? spec.slice(0, -1) : spec
                if (targets.has(source)) {
                    const exitCode = await executeTask(source, [], seen) /* RECURSION */
                    if (exitCode !== 0 && !optional)
                        return exitCode
                }
                if (source.startsWith("@")) {
                    const stat = await fs.promises.stat(source.slice(1)).catch(() => null)
                    if (stat === null && !optional)
                        throw new Error(`mandatory source file "${chalk.red(source)}" not found`)
                    if (stat !== null && targetDate > stat.mtimeMs)
                        sourcesOlderFiles++
                }
            }
            if (task.sources.length > 0 && task.sources.length === sourcesOlderFiles) {
                cli.log("info", `task <${chalk.blue(target)}> still up-to-date`)
                return 0
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

            /*  determine language and script  */
            let cmd = "shell"
            let av  = [] as string[]
            let ext = ""
            const env = { ...process.env }
            if (task.language === "js" || task.language === "ts") {
                /*  JavaScript/TypeScript via Node (always available)  */
                cmd = process.execPath
                env.NODE_PATH = getNodePath()
                ext = task.language
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
            else if (task.language !== "" && task.language !== "shell") {
                /*  custom language  */
                cmd = task.language
                ext = task.language
            }

            /*  support a mostly platform-agnostic shell script
                (mostly for very simple scripts which just call commands)  */
            let script = task.script
            if (cmd === "shell") {
                const isWin = process.platform === "win32"
                cmd = isWin ? "cmd" : "sh"
                av  = isWin ? [ "/c" ] : []
                ext = isWin ? "bat" : "sh"
                if (isWin) {
                    script = script.replaceAll(/\r?\n/g, "\r\n")
                    script = script.replaceAll(/\\\r\n/g, "^\r\n")
                    script = script.replaceAll(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, "%$1%")
                    script = script.replaceAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, "%$1%")

                    /*  prefix every command with "call", as "cmd" otherwise permanently
                        transfers control to an invoked batch file (like the tool wrappers
                        under "node_modules/.bin") and never returns to the rest of the script  */
                    script = script.replaceAll(/((?<!\^\r\n)^|&&|\|\||[&|])([ \t]*)(?=\S)/gm, "$1$2call ")
                }
            }

            /*  create script file  */
            const file = await tempfile(ext)
            await fs.promises.writeFile(file.path, script, "utf8")
            const quoted = quotedCommand([ cmd, ...av, file.path ])
            if (taskArgs.length > 0) {
                const argsQuoted = quotedCommand(taskArgs)
                cli.log("info", `command: ${chalk.blue(quoted)}, args: ${chalk.blue(argsQuoted)}`)
            }
            else
                cli.log("info", `command: ${chalk.blue(quoted)}`)
            const lines = script.split(/\r?\n/).slice(0, -1)
            for (const line of lines)
                cli.log("debug", `| ${chalk.blue(line)}`)

            /*  optionally show script information  */
            if (args.v >= 4)
                process.stderr.write(`${chalk.grey("_".repeat(78))}\n`)
            if (args.v >= 3 && task.comment !== "")
                process.stderr.write(`${chalk.grey.italic.inverse(`  ${task.comment}  `)}\n`)
            if (args.v >= 2) {
                const argv = quotedCommand(taskArgs)
                process.stderr.write(`${chalk.grey("$")} ${chalk.blue(cmd)} ` +
                    `${chalk.grey("[...]")} ${argv !== "" ? chalk.blue(argv) : ""}\n`)
            }
            if (args.v >= 1)
                for (const line of lines)
                    process.stderr.write(`${chalk.grey("| ")}${chalk.blue(line)}\n`)

            /*  extend environment  */
            const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH"
            env[pathKey] = await extendPath(env[pathKey] ?? "")
            env.STX_CMD  = quoted
            env.STX_ARGS = quotedCommand(taskArgs)
            for (const e of args.e) {
                const m = e.match(/^(.+?)=(.*)$/)
                if (m !== null) {
                    const [ , key, val ] = m
                    env[key] = val
                }
                else
                    env[e] = "1"
            }

            /*  execute script file  */
            const result = await execa(cmd, [ ...av, file.path, ...taskArgs ], {
                stdio:  "inherit",
                reject: false,
                env
            }).finally(() => file.remove())
            if (result.failed) {
                if (result.isTerminated) {
                    cli.log("error", `task <${chalk.blue(target)}> terminated with signal ${chalk.red(result.signal)}`)
                    return -1
                }
                else if (result.exitCode !== undefined && result.exitCode !== 0) {
                    cli.log("error", `task <${chalk.blue(target)}> terminated with non-zero exit code ${chalk.red(result.exitCode)}`)
                    return result.exitCode
                }
                else if (result.code !== undefined) {
                    cli.log("error", `task <${chalk.blue(target)}> terminated with Node error code ${chalk.red(result.code)} (${result.originalMessage})`)
                    return -1
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
                        return given.startsWith(request)
                    } },

                    /*  case-insensitive prefix match  */
                    { name: "case-insensitive prefix match", cb: (request: string, given: string) => {
                        return given.toLowerCase().startsWith(request.toLowerCase())
                    } }
                ]

                /*  pre-determine the name segments  */
                const segsRequested = taskName.split(/[^a-zA-Z0-9]+/)
                const segsGivenAll  = targets.keys().toArray().sort()
                    .map((name) => ({ name, segs: name.split(/[^a-zA-Z0-9]+/) }))

                /*  find matching targets, preferring stricter strategies over looser ones  */
                let taskNameExpanded: string[] = []
                for (let n = 1; n <= strategies.length && taskNameExpanded.length === 0; n++) {
                    const matchers = strategies.slice(0, n)
                    taskNameExpanded = segsGivenAll
                        .filter(({ segs }) => segs.length === segsRequested.length
                            && segs.every((seg, i) => matchers.some((s) => s.cb(segsRequested[i], seg))))
                        .map(({ name }) => name)
                }
                if (taskNameExpanded.length === 0) {
                    cli.log("error", `task request "${chalk.red(taskName)}" does not match any task`)
                    return -1
                }
                else if (taskNameExpanded.length > 1) {
                    const list = taskNameExpanded.map((t) => `<${chalk.blue(t)}>`).join(", ")
                    cli.log("error", `task request "${chalk.red(taskName)}" ambiguously matches more than one task: ${list}`)
                    return -1
                }
                else if (taskNameExpanded[0] !== taskName) {
                    cli.log("info", `task request "${chalk.red(taskName)}" expanded to task <${chalk.blue(taskNameExpanded[0])}>`)
                    taskName = taskNameExpanded[0]
                }
            }

            /*  execute the requested target  */
            return await executeTask(taskName, taskArgs)
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
                if (argvTask.length === 0)
                    return 0
                const [ taskName, ...taskArgs ] = argvTask
                argvTask = []
                return await executeTaskFuzzy(taskName, taskArgs)
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

