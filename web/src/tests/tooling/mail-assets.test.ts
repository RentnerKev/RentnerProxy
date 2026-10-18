import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decode } from 'fast-png'
import { build } from 'vite'

test('bundles mail branding into executable SSR without source asset paths', async () => {
    const parent = resolve(tmpdir())
    const root = await mkdtemp(join(parent, 'rentnerproxy-mail-assets-'))
    if (!resolve(root).startsWith(parent + sep)) throw new Error('Invalid fixture directory.')
    try {
        const source = resolve(import.meta.dir, '../..')
        const environment = join(root, 'empty-environment')
        const output = join(root, 'output')
        await mkdir(environment)
        await build({
            configFile: false,
            envDir: environment,
            root,
            publicDir: resolve(source, '../public'),
            logLevel: 'silent',
            resolve: { alias: { '@': source } },
            ssr: { noExternal: true },
            build: {
                ssr: join(source, 'server/Mail/mail-logo.ts'),
                outDir: output,
                copyPublicDir: false,
                emptyOutDir: false,
                minify: true,
                rolldownOptions: { output: { entryFileNames: 'mail-logo.mjs' } },
            },
        })
        const bundlePath = join(output, 'mail-logo.mjs')
        const code = await readFile(bundlePath, 'utf8')
        expect(code.match(/data:image\/png;base64,iVBORw0KGgo/gu)?.length).toBe(2)
        expect(code).not.toContain('rentnerproxy-logo-long.png')
        expect(code).not.toContain('rentnerproxy-logo-long-accent-mask.png')
        expect(code).not.toContain('?inline')
        expect(await readdir(output)).toEqual(['mail-logo.mjs'])
        expect(await readdir(environment)).toEqual([])

        const bundled: unknown = await import(pathToFileURL(bundlePath).href)
        if (
            typeof bundled !== 'object' ||
            bundled === null ||
            !('createMailLogoAttachment' in bundled) ||
            typeof bundled.createMailLogoAttachment !== 'function'
        ) {
            throw new Error('Missing executable mail logo export.')
        }
        const attachment: unknown = await bundled.createMailLogoAttachment('#ee3030')
        if (
            typeof attachment !== 'object' ||
            attachment === null ||
            !('content' in attachment) ||
            !Buffer.isBuffer(attachment.content)
        ) {
            throw new Error('The production logo must be an in-memory attachment.')
        }
        const image = decode(attachment.content)
        expect([image.width, image.height, image.channels, image.depth]).toEqual([512, 192, 4, 8])
        expect(attachment.content.length).toBeLessThan(400_000)
    } finally {
        // Remove only the verified, absolute mkdtemp directory owned by this test.
        await rm(root, { recursive: true, force: true })
    }
}, 30_000)
