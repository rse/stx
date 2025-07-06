
const fs        = require("node:fs")
const { execa } = require("execa")

;(async () => {
    let stxjs = "dst-stage2/stx.js"
    let stat = await fs.promises.stat(stxjs).catch((err) => null)
    if (stat === null)
        await execa("npx",
            [ "vite", "-l", "silent", "--config", "etc/vite.mts", "build", "--mode", "production" ],
            { stdin: "inherit", stdout: "ignore", stderr: "inherit" })
            .catch(() => process.exit(1))
    await execa(process.execPath,
        [ stxjs, ...process.argv.slice(2) ],
        { stdio: "inherit" })
        .catch(() => process.exit(1))
})()

