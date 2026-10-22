import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

describe('default-site HTML formatter', () => {
    test('authorizes before parsing, bounds UTF-8 drafts and preserves text without leaking diagnostics', async () => {
        const script = `
            import { strict as assert } from 'node:assert'
            import { mock } from 'bun:test'
            import { MAX_DEFAULT_SITE_HTML_BYTES } from './config/default-site.config.ts'
            let allowed = new Set()
            mock.module('./server/Auth/Access/authorization.service.ts', () => ({
                requirePermissionService: async (permission) => {
                    if (!allowed.has(permission)) throw Object.assign(new Error('Denied'), { code: 'permission_denied' })
                    return { id: 'formatter-test' }
                },
            }))
            const { formatDefaultSiteHtmlService: format } = await import('./server/DefaultSite/format-default-site-html.service.ts')
            await assert.rejects(format(null), { code: 'permission_denied' })
            allowed = new Set(['default_site.update'])
            await assert.rejects(format(null), { code: 'permission_denied' })
            allowed.add('proxy_hosts.apply')
            for (const invalid of [null, '', ' ', 'nul\\0byte', '\\ud800', 'ä'.repeat(MAX_DEFAULT_SITE_HTML_BYTES)]) {
                await assert.rejects(format(invalid))
            }
            const source = '<style>h1{color:red;margin:0}</style>\\n<pre>\\n  Keep\\n  these spaces  </pre>\\n<span>one</span> <span>two</span>'
            const output = await format(source)
            assert.ok(output.includes('color: red;'))
            assert.ok(output.includes('<pre>\\n  Keep\\n  these spaces  </pre>'))
            assert.ok(output.includes('<span>one</span> <span>two</span>'))
            assert.equal(await format(output), output)
            await assert.rejects(format('<div><span>private-draft-value</div>'), (error) => {
                assert.equal(error.message, 'HTML could not be formatted.')
                assert.equal(String(error).includes('private-draft-value'), false)
                return true
            })
            // Input fits the limit; indentation and CSS expansion must also fit it.
            const compact = '<style>' + 'h1{color:red;margin:0;padding:0}'.repeat(5_000) + '</style>'
            assert.ok(Buffer.byteLength(compact) < MAX_DEFAULT_SITE_HTML_BYTES)
            await assert.rejects(format(compact))
            // Isolate subprocess failures and output bounds without logging private diagnostics.
            const originalSpawn = Bun.spawn
            let killed = 0
            const stream = (bytes) => new ReadableStream({ start(controller) {
                controller.enqueue(bytes)
                controller.close()
            } })
            const safeFailure = (error) => {
                assert.equal(error.message, 'HTML could not be formatted.')
                assert.equal(String(error).includes('private-draft-value'), false)
                return true
            }
            try {
                Bun.spawn = () => { throw new Error('private-draft-value') }
                await assert.rejects(format('<div>valid</div>'), safeFailure)
                for (const [stdout, stderr, exitCode] of [
                    [new TextEncoder().encode('<div>valid</div>'), new TextEncoder().encode('private-draft-value'), 2],
                    [new Uint8Array(MAX_DEFAULT_SITE_HTML_BYTES + 1), new Uint8Array(), 0],
                    [new Uint8Array(), new Uint8Array(MAX_DEFAULT_SITE_HTML_BYTES + 1), 0],
                    [new Uint8Array([0xff]), new Uint8Array(), 0],
                    [new Uint8Array(), new Uint8Array(), 137],
                ]) {
                    Bun.spawn = (command, options) => {
                        assert.equal(command[0], process.execPath)
                        for (const flag of ['--no-env-file', '--no-script', '--no-config', '--no-editorconfig', '--html-whitespace-sensitivity=strict']) {
                            assert.ok(command.includes(flag))
                        }
                        assert.equal(options.timeout, 5_000)
                        assert.equal(options.killSignal, 'SIGKILL')
                        assert.ok(options.stdin instanceof Blob)
                        return { stdout: stream(stdout), stderr: stream(stderr), exited: Promise.resolve(exitCode), kill: () => { killed++ } }
                    }
                    await assert.rejects(format('<div>valid</div>'), safeFailure)
                }
                assert.equal(killed, 5)
            } finally {
                Bun.spawn = originalSpawn
            }
            console.log('html-format-ok')
        `
        const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
            cwd: fileURLToPath(new URL('../../..', import.meta.url)),
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
        expect(stdout).toContain('html-format-ok')
    })
})
