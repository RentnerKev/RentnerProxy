import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { createServer, isRunnableDevEnvironment } from 'vite'

test('serves the actual mail logo route to anonymous image requests through TanStack Start', async () => {
    const parent = resolve(import.meta.dir, '../../../../tmp')
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'mail-logo-route-'))
    if (!resolve(root).startsWith(parent + sep)) throw new Error('Invalid fixture directory.')
    try {
        const source = resolve(import.meta.dir, '../..')
        const routes = join(root, 'src/routes')
        await mkdir(join(routes, 'media/mail-logo'), { recursive: true })
        await writeFile(
            join(routes, '__root.tsx'),
            `import { createRootRoute } from '@tanstack/react-router'
export const Route = createRootRoute({})`,
        )
        await writeFile(
            join(root, 'src/router.ts'),
            `import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen.ts'
export const getRouter = () => createRouter({ routeTree })`,
        )
        await writeFile(
            join(routes, 'media/mail-logo/$accent.ts'),
            await readFile(join(source, 'routes/media/mail-logo/$accent.ts')),
        )
        const server = await createServer({
            configFile: false,
            root,
            envDir: root,
            logLevel: 'silent',
            resolve: { alias: { '@': source } },
            plugins: [tanstackStart()],
            optimizeDeps: { noDiscovery: true },
            server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
        })
        try {
            await server.listen()
            // Seed a trusted image in the same SSR module graph. Admission behavior
            // is tested with a fake Valkey client; this fixture must never contact one.
            const ssr = server.environments.ssr
            if (!ssr || !isRunnableDevEnvironment(ssr)) throw new Error('Missing SSR runner.')
            const renderer = await ssr.runner.import<{
                getMailLogoPng: (accent: string) => Promise<Buffer>
            }>('@/server/Mail/mail-logo.ts')
            await renderer.getMailLogoPng('#8844ee')
            const origin = server.resolvedUrls?.local[0]
            if (!origin) throw new Error('The image fixture must listen locally.')
            const url = new URL('/media/mail-logo/8844ee?v=1', origin)
            const response = await fetch(url)
            expect(response.status).toBe(200)
            expect(response.headers.get('Content-Type')).toBe('image/png')
            expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')
            expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
            expect(response.headers.get('Content-Disposition')).toBeNull()
            expect(response.headers.get('Set-Cookie')).toBeNull()
            expect(new Uint8Array(await response.arrayBuffer()).subarray(0, 8)).toEqual(
                new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            )
            const etag = response.headers.get('ETag')
            if (!etag) throw new Error('The logo must have a cache validator.')
            const cached = await fetch(url, { headers: { 'If-None-Match': etag } })
            expect(cached.status).toBe(304)
            expect((await cached.arrayBuffer()).byteLength).toBe(0)
            const invalid = await fetch(new URL('/media/mail-logo/not-a-color', origin))
            expect(invalid.status).toBe(404)
            expect(invalid.headers.get('Cache-Control')).toBe('no-store')
        } finally {
            await server.close()
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
}, 30_000)
