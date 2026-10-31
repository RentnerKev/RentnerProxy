import { expect, test } from 'bun:test'
import { createBackupsHttpHandlers } from '@/server/Admin/Backups/backups-response.server.ts'
import { BackupDomainError } from '@/server/Admin/Backups/backup.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'

const origin = 'https://admin.example.test'
const requestId = '00000000-0000-4000-8000-000000000001'
const status: ManagedBackupStatus = {
    storeId: requestId,
    configuration: {
        revision: 0,
        enabled: false,
        intervalHours: 24,
        retentionCount: 7,
        nextRunAt: null,
    },
    jobs: [],
    auditEvents: [],
}
const config = {
    requestId,
    expectedRevision: 0,
    enabled: true,
    intervalHours: 48,
    retentionCount: 3,
}
function harness(error?: Error, configuredOrigin: string | null = origin) {
    const calls: { operation: string; input?: unknown }[] = []
    const invoke = async (operation: string, input?: unknown) => {
        calls.push({ operation, input })
        if (error) throw error
        return status
    }
    return {
        calls,
        handlers: createBackupsHttpHandlers({
            origin: () => configuredOrigin,
            service: {
                getBackupsStatusService: () => invoke('status'),
                requestBackupService: (input) => invoke('start', input),
                updateBackupConfigurationService: (input) => invoke('config', input),
            },
        }),
    }
}
const get = (suffix = '') => new Request(origin + '/api/admin/backups/status' + suffix)
function post(
    operation = 'start',
    body: BodyInit = JSON.stringify({ requestId }),
    headers: HeadersInit = {},
) {
    return new Request(origin + '/api/admin/backups/' + operation, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', ...headers },
        body,
    })
}

test('reachable backup handlers delegate fixed operations and distinguish durable admission from completion', async () => {
    const f = harness()
    const read = await f.handlers.status(get())
    const start = await f.handlers.start(post())
    const save = await f.handlers.configure(post('config', JSON.stringify(config)))
    expect([read.status, start.status, save.status]).toEqual([200, 202, 200])
    expect(await read.json()).toEqual(status)
    expect(await start.json()).toEqual(status)
    expect(await save.json()).toEqual(status)
    expect(f.calls).toEqual([
        { operation: 'status', input: undefined },
        { operation: 'start', input: { requestId } },
        { operation: 'config', input: config },
    ])
    for (const response of [read, start, save]) {
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    }
})

test.each(['authentication_required', 'permission_denied'] as const)(
    'existing service %s produces explicit authorization failure rather than a missing API',
    async (code) => {
        const f = harness(new AuthDomainError(code, 'private internal detail'))
        const responses = await Promise.all([
            f.handlers.status(get()),
            f.handlers.start(post()),
            f.handlers.configure(post('config', JSON.stringify(config))),
        ])
        expect(responses.map((response) => response.status)).toEqual(
            Array(3).fill(code === 'authentication_required' ? 401 : 403),
        )
        expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
            responses.map(() => ({ error: code })),
        )
    },
)

test.each([null, 'https://other.example.test'])(
    'missing or cross-origin mutations are forbidden even with forged matching Host: %s',
    async (suppliedOrigin) => {
        const f = harness()
        const request = post()
        if (suppliedOrigin === null) request.headers.delete('origin')
        else request.headers.set('origin', suppliedOrigin)
        request.headers.set('host', new URL(suppliedOrigin ?? origin).host)
        expect((await f.handlers.start(request)).status).toBe(403)
        expect(f.calls).toHaveLength(0)
    },
)

test('unconfigured origin cannot authorize a mutation and successful configured-origin checks do not replace auth', async () => {
    expect((await harness(undefined, null).handlers.start(post())).status).toBe(403)
    expect(
        (
            await harness(new AuthDomainError('authentication_required', 'fixture')).handlers.start(
                post(),
            )
        ).status,
    ).toBe(401)
})

test('wrong methods, query options and content types are rejected before service dispatch', async () => {
    const f = harness()
    const wrongMethod = await f.handlers.start(get())
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')
    expect((await f.handlers.status(get('?path=/private'))).status).toBe(400)
    const query = post()
    const url = new URL(query.url)
    url.search = '?destination=/private'
    expect((await f.handlers.start(new Request(url, query))).status).toBe(400)
    expect(
        (await f.handlers.start(post('start', '{}', { 'content-type': 'text/plain' }))).status,
    ).toBe(415)
    expect(f.calls).toHaveLength(0)
})

test.each([
    '{}',
    '{',
    JSON.stringify({ requestId, actorId: requestId }),
    JSON.stringify({ requestId, destination: '/private' }),
])('invalid or impersonated JSON cannot reach service: %s', async (body) => {
    const f = harness()
    expect((await f.handlers.start(post('start', body))).status).toBe(400)
    expect(f.calls).toHaveLength(0)
})

test('invalid schedule bounds, missing body and malformed UTF-8 cannot reach service', async () => {
    const f = harness()
    expect(
        (
            await f.handlers.configure(
                post('config', JSON.stringify({ ...config, intervalHours: 0 })),
            )
        ).status,
    ).toBe(400)
    expect(
        (
            await f.handlers.start(
                new Request(origin + '/api/admin/backups/start', {
                    method: 'POST',
                    headers: { origin, 'content-type': 'application/json' },
                }),
            )
        ).status,
    ).toBe(400)
    expect((await f.handlers.start(post('start', Uint8Array.from([0xc3, 0x28])))).status).toBe(400)
    expect(f.calls).toHaveLength(0)
})

test('incremental 2 KiB limit rejects an oversized stream without trusting Content-Length', async () => {
    const f = harness()
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(1024))
            controller.enqueue(new Uint8Array(1025))
            controller.close()
        },
    })
    const response = await f.handlers.start(
        new Request(origin + '/api/admin/backups/start', {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json', 'content-length': '1' },
            body,
        }),
    )
    expect(response.status).toBe(400)
    expect(f.calls).toHaveLength(0)
})

test('rate limits preserve Retry-After and safe errors never expose exception text', async () => {
    const limited = await harness(
        new RateLimitError(11, 10, 1501, 'backup-mutation'),
    ).handlers.start(post())
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('2')
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
    await Promise.all(
        (['busy', 'capacity', 'revision_conflict', 'unavailable'] as const).map(async (code) => {
            const response = await harness(new BackupDomainError(code)).handlers.start(post())
            expect(response.status).toBe(code === 'unavailable' ? 503 : 409)
            expect(await response.json()).toEqual({ error: code })
            expect(response.headers.get('cache-control')).toBe('private, no-store')
        }),
    )
    const unexpected = await harness(
        new TypeError('private path and credential fixture'),
    ).handlers.start(post())
    expect(unexpected.status).toBe(503)
    expect(await unexpected.json()).toEqual({ error: 'unavailable' })
})

test('cancelled requests are not dispatched', async () => {
    const f = harness()
    const controller = new AbortController()
    controller.abort()
    const response = await f.handlers.start(new Request(post(), { signal: controller.signal }))
    expect(response.status).toBe(499)
    expect(f.calls).toHaveLength(0)
})
