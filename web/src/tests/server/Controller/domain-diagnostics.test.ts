// oxlint-disable no-await-in-loop -- Exercise each independent invalid response and its rejection before continuing.
import { expect, test } from 'bun:test'
import { createDomainDiagnosticsController } from '@/server/Controller/domain-diagnostics.server.ts'
import {
    domainDiagnosticsFixture,
    domainDiagnosticsInput,
    diagnosticRevision,
} from '@/tests/lib/RuntimeDiagnostics/domain-diagnostics.fixture.ts'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

const input = { ...domainDiagnosticsInput, expectedRevision: diagnosticRevision }
test('controller enforces bounded confidential POST, caller abort and exact selector/revision echoes', async () => {
    const signal = new AbortController().signal
    const inspect = createDomainDiagnosticsController(async (path, options) => {
        expect(path).toBe('/internal/v1/diagnostics/domain')
        expect(options).toMatchObject({
            timeoutMs: 14_000,
            responseLimit: 65_536,
            privileged: true,
            confidential: true,
            method: 'POST',
            signal,
        })
        expect(JSON.parse(options.body!)).toEqual(input)
        return domainDiagnosticsFixture()
    })
    expect(await inspect(input, signal)).toEqual(domainDiagnosticsFixture())
    for (const mismatch of [
        { hostId: '0198d98a-0000-7000-8000-000000000002' },
        { domain: 'other.example.com' },
        {
            expectedRevision: 'sha256:' + 'b'.repeat(64),
            activeRevision: 'sha256:' + 'b'.repeat(64),
        },
        { password: 'PRIVATE' },
    ]) {
        await expect(
            createDomainDiagnosticsController(async () => ({
                ...domainDiagnosticsFixture(),
                ...mismatch,
            }))(input),
        ).rejects.toMatchObject({ code: 'runtime_unavailable' })
    }
})

test('only strict allowlisted controller errors cross the boundary', async () => {
    for (const code of ['invalid_input', 'busy', 'runtime_unavailable'])
        await expect(
            createDomainDiagnosticsController(async () => ({ error: code }))(input),
        ).rejects.toMatchObject({ code })
    for (const payload of [{ error: 'PRIVATE' }, { error: 'busy', token: 'PRIVATE' }, null])
        await expect(
            createDomainDiagnosticsController(async () => payload)(input),
        ).rejects.toMatchObject({ code: 'runtime_unavailable' })
})

test('transport requires bearer auth even on loopback and composes caller abort/deadlines with listener cleanup', async () => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        let token = ''; let calls = 0; let added = 0; let removed = 0; let aborted = 0
        mock.module('./server/env.server.ts', () => ({ getControllerBaseUrl: () => 'http://127.0.0.1:18081', getControllerToken: () => token, isLoopbackControllerUrl: () => true }))
        const { controllerRequest } = await import('./server/Controller/transport.server.ts')
        globalThis.fetch = Object.assign(async (_url, init) => { calls++; return new Promise((_resolve, reject) => { const abort = () => { aborted++; reject(new Error('PRIVATE-abort')) }; if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }) }) }, { preconnect: () => undefined })
        const denied = await controllerRequest('/internal/v1/diagnostics/domain', { timeoutMs: 10, method: 'POST', confidential: true, privileged: true })
        token = 'fixture-token'
        const cancellation = new AbortController()
        const add = cancellation.signal.addEventListener.bind(cancellation.signal), remove = cancellation.signal.removeEventListener.bind(cancellation.signal)
        cancellation.signal.addEventListener = (...args) => { added++; return add(...args) }
        cancellation.signal.removeEventListener = (...args) => { removed++; return remove(...args) }
        const pending = controllerRequest('/internal/v1/diagnostics/domain', { timeoutMs: 1000, signal: cancellation.signal, method: 'POST', confidential: true, privileged: true })
        cancellation.abort(); await pending
        await controllerRequest('/internal/v1/diagnostics/domain', { timeoutMs: 5, method: 'POST', confidential: true, privileged: true })
        const already = new AbortController(); already.abort()
        await controllerRequest('/internal/v1/diagnostics/domain', { timeoutMs: 10, signal: already.signal })
        console.log(JSON.stringify({ denied, calls, added, removed, aborted }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    expect(JSON.parse(output)).toEqual({ denied: null, calls: 2, added: 1, removed: 1, aborted: 2 })
})
