import { expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countries } from 'country-flag-icons'
import { version } from 'country-flag-icons/package.json'
import { createServer } from 'vite'
import { prepareCountryFlags } from '../../../../../../scripts/assets/prepare-country-flags.ts'
import { createStaticAssetFetch } from '../../../../../../docker/web/static-assets.ts'

test('prepares individual flags for development and production with versioned immutable caching', async () => {
    const parent = resolve(tmpdir())
    const root = await mkdtemp(join(parent, 'rentnerproxy-country-flags-'))
    if (!resolve(root).startsWith(parent + sep)) throw new Error('Invalid fixture directory.')
    try {
        await writeFile(join(root, 'favicon.ico'), 'existing public asset')
        await prepareCountryFlags(root)
        await prepareCountryFlags(root)
        expect(await readFile(join(root, 'favicon.ico'), 'utf8')).toBe('existing public asset')
        const directory = join(root, 'assets', 'country-flags', version)
        expect((await readdir(directory)).toSorted()).toEqual(
            countries
                .filter((code) => /^[A-Z]{2}$/u.test(code))
                .map((code) => `${code}.svg`)
                .toSorted(),
        )
        const packageRoot = dirname(
            fileURLToPath(import.meta.resolve('country-flag-icons/package.json')),
        )
        const original = await readFile(join(packageRoot, '3x2', 'DE.svg'), 'utf8')
        const fetchAsset = createStaticAssetFetch(root, () => new Response(null, { status: 404 }))
        const url = `http://localhost/assets/country-flags/${version}/DE.svg`
        const server = { requestIP: () => null }
        const response = await fetchAsset(new Request(url), server)
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toStartWith('image/svg+xml')
        expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
        expect(await response.text()).toBe(original)
        const head = await fetchAsset(new Request(url, { method: 'HEAD' }), server)
        expect(head.status).toBe(200)
        expect(await head.text()).toBe('')
        const unknown = await fetchAsset(
            new Request(`http://localhost/assets/country-flags/${version}/ZZ.svg`),
            server,
        )
        expect(unknown.status).toBe(404)

        const development = await createServer({
            configFile: false,
            envFile: false,
            root,
            publicDir: root,
            logLevel: 'silent',
            optimizeDeps: { noDiscovery: true },
            server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
        })
        try {
            await development.listen()
            const address = development.httpServer?.address()
            if (!address || typeof address === 'string') throw new Error('Missing dev address.')
            const devResponse = await fetch(
                `http://127.0.0.1:${address.port}/assets/country-flags/${version}/DE.svg`,
            )
            expect(devResponse.status).toBe(200)
            expect(devResponse.headers.get('content-type')).toStartWith('image/svg+xml')
            expect(await devResponse.text()).toBe(original)
        } finally {
            await development.close()
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
