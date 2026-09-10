/*
**  stx -- Simple Task Execution
**  Copyright (c) 2025-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under MIT <https://spdx.org/licenses/MIT>
*/

import * as Vite          from "vite"
import commonjs           from "vite-plugin-commonjs"
import { tscPlugin }      from "@wroud/vite-plugin-tsc"
import nodeExternals      from "rollup-plugin-node-externals"

export default Vite.defineConfig(({ command, mode }) => ({
    logLevel: "info",
    appType: "custom",
    base: "",
    root: "",
    plugins: [
        tscPlugin({
            tscArgs: [ "--build", "etc/tsc.json" ],
            packageManager: "npx" as "npm",
            prebuild: true
        }),
        nodeExternals({
            builtins: true,
            devDeps:  false,
            deps:     false,
            optDeps:  false,
            peerDeps: false
        }),
        commonjs()
    ],
    resolve: {
        mainFields: [ "module", "jsnext:main", "jsnext" ],
        conditions: [ "node" ],
    },

    /*  polyfill the ESM-only "import.meta" properties for the CommonJS output format, as the
        Rolldown bundler of Vite 8 otherwise silently replaces "import.meta" with "{}". The
        polyfills are injected via the output banner (see below), because bundled modules can
        shadow the "require" identifier and hence cannot be referenced inline here.  */
    define: {
        "import.meta.url":     "__stxImportMetaUrl",
        "import.meta.resolve": "__stxImportMetaResolve"
    },
    build: {
        lib: {
            entry:    "dst-stage1/stx.js",
            formats:  [ "cjs" ],
            name:     "stx",
            fileName: () => "stx.js"
        },
        target:                 "esnext",
        outDir:                 "dst-stage2",
        assetsDir:              "",
        emptyOutDir:            (mode === "production"),
        chunkSizeWarningLimit:  5000,
        assetsInlineLimit:      0,
        sourcemap:              (mode === "development"),
        minify:                 (mode === "production"),
        reportCompressedSize:   false,
        commonjsOptions: {
            include: [ /node_modules/ ]
        },
        rollupOptions: {
            external: [],
            output: {
                banner: [
                    "#!/usr/bin/env node",
                    "const __stxImportMetaUrl     = require(\"node:url\").pathToFileURL(__filename).href",
                    "const __stxImportMetaResolve = require(\"node:module\").createRequire(__filename).resolve"
                ].join("\n"),
                codeSplitting: false
            },
            onwarn (warning, warn) {
                if (warning.message.match(/Use of eval.*?is strongly discouraged/))
                    return
                warn(warning)
            }
        }
    }
}))

