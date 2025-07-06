
const fs        = require("node:fs")
const { execa } = require("execa")

;(async () => {
    const stat = await fs.promises.stat("dst-stage1/stx.js")
        .catch((err) => null)
    if (stat === null)
        await execa("npx",
            [ "tsc", "--project", "etc/tsc.json" ],
            { stdio: "inherit" })
            .catch(() => process.exit(1))
    await execa(process.execPath,
        [ "./dst-stage1/stx.js", ...process.argv.slice(2) ],
        { stdio: "inherit" })
        .catch(() => process.exit(1))
})()

