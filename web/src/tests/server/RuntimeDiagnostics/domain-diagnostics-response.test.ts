// oxlint-disable no-await-in-loop -- Each response body must be consumed before checking the next isolated error case.
import { expect, test } from 'bun:test'
import { createDomainDiagnosticsPostHandler } from '@/server/RuntimeDiagnostics/domain-diagnostics-response.server.ts'
import { DomainDiagnosticsError } from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import {
    domainDiagnosticsFixture,
    domainDiagnosticsInput,
} from '@/tests/lib/RuntimeDiagnostics/domain-diagnostics.fixture.ts'

function request(
    body = JSON.stringify(domainDiagnosticsInput),
    origin = 'https://admin.example.com',
    type = 'application/json',
) {
    return new Request('https://admin.example.com/api/admin/diagnostics/domain', {
        method: 'POST',
        headers: { origin, 'content-type': type },
        body,
    })
}
test('raw POST enforces same-origin, JSON and 4KiB bounds before delegating shared service', async () => {
    let calls = 0
    const handler = createDomainDiagnosticsPostHandler({
        origin: () => 'https://admin.example.com',
        diagnose: async (value, signal) => {
            calls++
            expect(value).toEqual(domainDiagnosticsInput)
            expect(signal).toBeInstanceOf(AbortSignal)
            return domainDiagnosticsFixture()
        },
    })
    expect((await handler(request('{}', 'https://foreign.example'))).status).toBe(403)
    expect((await handler(request('{}', '', 'application/json'))).status).toBe(403)
    expect((await handler(request('{}', 'https://admin.example.com', 'text/plain'))).status).toBe(
        415,
    )
    expect((await handler(request('{'))).status).toBe(400)
    expect((await handler(request(' '.repeat(4097)))).status).toBe(400)
    expect(calls).toBe(0)
    const result = await handler(request())
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.json()).toEqual(domainDiagnosticsFixture())
    expect(calls).toBe(1)
})

test('raw POST returns closed auth/status errors and empty499 on cancelled requests', async () => {
    for (const [error, status, code] of [
        [new AuthDomainError('authentication_required', 'PRIVATE'), 401, 'authentication_required'],
        [new AuthDomainError('permission_denied', 'PRIVATE'), 403, 'permission_denied'],
        [new DomainDiagnosticsError('configuration_changed'), 409, 'configuration_changed'],
        [new DomainDiagnosticsError('busy'), 429, 'busy'],
        [new DomainDiagnosticsError('rate_limited'), 429, 'rate_limited'],
        [new Error('PRIVATE-TOKEN'), 503, 'runtime_unavailable'],
    ] as const) {
        const handler = createDomainDiagnosticsPostHandler({
            origin: () => 'https://admin.example.com',
            diagnose: async () => {
                throw error
            },
        })
        const result = await handler(request())
        expect(result.status).toBe(status)
        expect(await result.json()).toEqual({ error: code })
        expect(result.headers.get('cache-control')).toBe('private, no-store')
    }
    let calls = 0
    const aborted = new AbortController()
    aborted.abort()
    const handler = createDomainDiagnosticsPostHandler({
        origin: () => 'https://admin.example.com',
        diagnose: async () => {
            calls++
            return domainDiagnosticsFixture()
        },
    })
    const result = await handler(
        new Request('https://admin.example.com/api/admin/diagnostics/domain', {
            method: 'POST',
            signal: aborted.signal,
        }),
    )
    expect(result.status).toBe(499)
    expect(await result.text()).toBe('')
    expect(calls).toBe(0)
})
