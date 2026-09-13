import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { createLiveVitePlugin } from './vite-live'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const cacheDirectory = fileURLToPath(new URL('../node_modules/.vite/web', import.meta.url))
const serverBuiltins = [
    ...builtinModules.filter((moduleName) => !moduleName.includes(':')),
    /^node:/,
    /^bun:/,
    'bun',
]

export default defineConfig({
    define: {
        RENTNERPROXY_BUILD_VERSION: JSON.stringify(
            process.env.RENTNERPROXY_BUILD_VERSION ||
                JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
                    .version + '-dev',
        ),
    },
    root: webRoot,
    envDir: repositoryRoot,
    cacheDir: cacheDirectory,
    optimizeDeps: {
        exclude: ['bun'],
    },
    environments: {
        ssr: {
            resolve: {
                builtins: serverBuiltins,
                external: ['bun'],
            },
        },
    },
    build: {
        rolldownOptions: {
            external: ['bun'],
        },
    },
    server: {
        host: 'localhost',
        port: 5173,
        strictPort: true,
    },
    plugins: [
        createLiveVitePlugin(),
        tanstackStart({
            importProtection: {
                client: {
                    files: ['**/*.server.*', '**/*.service.*', '**/db/**', '**/server/**'],
                },
            },
        }),
        viteReact(),
        tailwindcss(),
    ],
})
