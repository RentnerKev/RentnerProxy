import { fileURLToPath } from 'node:url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const cacheDirectory = fileURLToPath(new URL('../node_modules/.vite/web', import.meta.url))

export default defineConfig({
  root: webRoot,
  envDir: repositoryRoot,
  cacheDir: cacheDirectory,
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
})
