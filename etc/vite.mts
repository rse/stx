/*
**  stx -- Simple Task Execution
**  Copyright (c) 2025 Dr. Ralf S. Engelschall <rse@engelschall.com>
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
            tscArgs: [ "--project", "etc/tsc.json" ],
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
                banner: "#!/usr/bin/env node",
                inlineDynamicImports: true
            },
            onwarn (warning, warn) {
                if (warning.message.match(/Use of eval.*?is strongly discouraged/))
                    return
                warn(warning)
            }
        }
    }
}))

