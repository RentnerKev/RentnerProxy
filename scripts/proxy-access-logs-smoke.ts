// oxlint-disable no-await-in-loop -- bounded request batches and readiness polling.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

interface LogEntry {
    readonly timestamp: string
    readonly host: string
    readonly method: string
    readonly path: string
    readonly status: number
    readonly durationMs: number
    readonly clientIp: string
    readonly upstream: string | null
    readonly bytes: number
    readonly protocol: string
}

interface LogPage {
    readonly entries: LogEntry[]
    readonly limit: number
    readonly offset: number
    readonly total: number
    readonly hasMore: boolean
    readonly truncated: boolean
    readonly snapshot: string
    readonly snapshotExpiresAt: string
    readonly snapshotReset: boolean
}

interface SmokeOptions {
    readonly controllerUrl: string
    readonly httpUrl: string
    readonly runtimeContainer: string
    readonly controllerRequest: (path: string) => Promise<Response>
    readonly command: (args: string[]) => Promise<string>
    readonly restart: () => Promise<void>
    readonly waitFor: (check: () => Promise<boolean>, label: string) => Promise<void>
}

export async function verifyProxyAccessLogs(options: SmokeOptions): Promise<void> {
    const { controllerRequest, httpUrl, runtimeContainer, command, waitFor } = options
    const endpoint = '/internal/v1/proxy/access-logs'
    const host = 'policy.example.com'
    const marker = 'access-log-smoke-' + randomUUID()
    const secret = 'must-never-be-logged-' + randomUUID()
    const readPage = async (query: string): Promise<LogPage> => {
        const response = await controllerRequest(endpoint + '?' + query)
        assert.equal(response.status, 200)
        return (await response.json()) as LogPage
    }
    const request = async (path: string, sensitive = false): Promise<void> => {
        const response = await fetch(httpUrl + path, {
            method: sensitive ? 'POST' : 'GET',
            headers: {
                host,
                ...(sensitive
                    ? {
                          authorization: 'Bearer ' + secret,
                          cookie: 'session=' + secret,
                          'x-secret-metadata': secret,
                          'content-type': 'text/plain',
                      }
                    : {}),
            },
            ...(sensitive ? { body: secret } : {}),
            signal: AbortSignal.timeout(10_000),
        })
        assert.equal(response.status, 200)
        await response.arrayBuffer()
    }

    const unauthorized = await fetch(options.controllerUrl + endpoint, {
        signal: AbortSignal.timeout(5_000),
    })
    assert.equal(unauthorized.status, 401)
    await unauthorized.body?.cancel()
    for (const query of ['limit=201', 'offset=10001', 'status=99']) {
        const response = await controllerRequest(endpoint + '?' + query)
        assert.equal(response.status, 422)
        await response.body?.cancel()
    }

    await request('/' + marker + '/first?secret=' + secret, true)
    await request('/' + marker + '/second')
    const query = new URLSearchParams({ host, status: '200', search: marker, limit: '1' })
    await waitFor(async () => (await readPage(query.toString())).total === 2, 'Caddy access logs')
    const firstPage = await readPage(query.toString())
    assert.equal(firstPage.entries.length, 1)
    assert.equal(firstPage.hasMore, true)
    assert.equal(firstPage.entries[0]?.path, '/' + marker + '/second')
    assert.equal(firstPage.snapshotReset, false)
    assert.ok(Number.isFinite(Date.parse(firstPage.snapshotExpiresAt)))
    await request('/' + marker + '/new-during-paging')
    query.set('snapshot', firstPage.snapshot)
    query.set('offset', '1')
    const secondPage = await readPage(query.toString())
    assert.equal(secondPage.entries[0]?.path, '/' + marker + '/first')
    assert.equal(secondPage.entries[0]?.method, 'POST')
    assert.equal(secondPage.hasMore, false)
    assert.equal(secondPage.total, 2)
    assert.equal(secondPage.snapshot, firstPage.snapshot)
    const entry = secondPage.entries[0]!
    assert.equal(entry.host, host)
    assert.equal(entry.status, 200)
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)))
    assert.ok(entry.durationMs >= 0)
    assert.ok(entry.bytes > 0)
    assert.ok(entry.clientIp.length > 0)
    assert.ok(entry.protocol.startsWith('HTTP/'))
    assert.ok(entry.upstream && entry.upstream.includes(':'))
    assert.equal(JSON.stringify([firstPage, secondPage]).includes(secret), false)
    const rawLogs = await command([
        'docker',
        'exec',
        runtimeContainer,
        'sh',
        '-c',
        'cat /var/lib/rentnerproxy/proxy/logs/access*.log',
    ])
    assert.equal(rawLogs.includes(secret), false)
    assert.equal(rawLogs.includes('x-secret-metadata'), false)
    assert.equal(rawLogs.includes('"headers"'), false)
    assert.equal(rawLogs.includes('"user_id"'), false)
    query.set('host', 'different.example.com')
    const changedFilter = await readPage(query.toString())
    assert.equal(changedFilter.total, 0)
    assert.equal(changedFilter.snapshotReset, true)
    assert.equal(changedFilter.offset, 0)
    query.delete('snapshot')
    query.set('host', host)
    query.set('status', '403')
    assert.equal((await readPage(query.toString())).total, 0)
    query.set('status', '200')
    query.set('offset', '0')
    await options.restart()
    query.set('snapshot', firstPage.snapshot)
    query.set('offset', '1')
    const restartedPage = await readPage(query.toString())
    assert.equal(restartedPage.total, 3)
    assert.equal(restartedPage.snapshotReset, true)
    assert.equal(restartedPage.offset, 0)
    query.set('snapshot', restartedPage.snapshot)
    query.set('offset', '0')

    const padding = 'x'.repeat(1800)
    for (let start = 0; start < 12_000; start += 24) {
        await Promise.all(
            Array.from({ length: 24 }, (_, index) =>
                request('/log-volume-' + (start + index) + '-' + padding),
            ),
        )
    }
    await request('/' + marker + '/after-volume')
    await waitFor(async () => {
        const sizes = await command([
            'docker',
            'exec',
            runtimeContainer,
            'sh',
            '-c',
            "stat -c '%s' /var/lib/rentnerproxy/proxy/logs/access*.log",
        ])
        const files = sizes.split(/\r?\n/u).map(Number)
        return files.length === 5 && files.every((size) => size <= 4 * 1024 * 1024)
    }, 'bounded access log rotation')
    await waitFor(
        async () => (await readPage('limit=1')).entries[0]?.path === '/' + marker + '/after-volume',
        'newest access log after rotation',
    )
    const boundedPage = await readPage('limit=200')
    assert.equal(boundedPage.truncated, true)
    assert.equal(boundedPage.entries.length, 200)
    assert.equal(boundedPage.entries[0]?.path, '/' + marker + '/after-volume')
    assert.ok(boundedPage.total <= 10_000)
    const retainedPage = await readPage(query.toString())
    assert.equal(retainedPage.snapshot, restartedPage.snapshot)
    assert.equal(retainedPage.snapshotReset, false)
    assert.equal(retainedPage.total, 3)
    assert.deepEqual(retainedPage.entries, restartedPage.entries)
    const lastPage = await readPage('offset=10000')
    assert.equal(lastPage.entries.length, 0)
    assert.equal(lastPage.hasMore, false)
}
