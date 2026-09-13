import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('live snapshots enforce canonical origin, query limits and current permissions', async () => {
    const script = `
        import { mock } from 'bun:test'
        import { AuthDomainError } from './server/Auth/Core/errors.server.ts'
        let authorized = true
        let reads = 0
        let permissionChecks = 0
        mock.module('./server/env.server.ts', () => ({ getPublicOrigin: () => 'https://proxy.example' }))
        mock.module('./websockets/Helpers/publishFunctions.ts', () => ({ getApplicationRevision: () => 'revision' }))
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async () => {
                permissionChecks++
                if (!authorized) throw new AuthDomainError('permission_denied', 'Denied')
                return { id: 'current-user', permissions: ['app.access'] }
            },
        }))
        mock.module('./server/Foundation/health.service.ts', () => ({ checkFoundationHealth: async () => { reads++; return { database: { state: 'connected' } } } }))
        mock.module('./server/Admin/ProxyAccessLogs/proxy-access-logs.service.ts', () => ({ getProxyAccessLogsService: async (query) => { reads++; return { query, entries: [] } } }))
        mock.module('./server/Audit/audit-reader.service.ts', () => ({ listAuditEventsService: async () => { reads++; return { events: [] } } }))
        mock.module('./server/Admin/ProxyHostManagement/proxy-hosts.service.ts', () => ({ getProxyHostsService: async () => [] }))
        mock.module('./server/Admin/CertificateManagement/certificates.service.ts', () => ({ getCertificatesService: async () => [] }))
        mock.module('./server/Admin/RedirectHostManagement/redirect-hosts.service.ts', () => ({ getRedirectHostsService: async () => [] }))
        mock.module('./server/Admin/AccessPolicyManagement/access-policies.service.ts', () => ({ getAccessPoliciesService: async () => [] }))
        mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({ getProxyRuntimeStatusService: async () => ({ state: 'synced' }) }))
        const { getLiveSnapshotResponse } = await import('./websockets/Server/realtimeSnapshots.service.ts')
        async function read(topic, query = '{}', origin = 'https://proxy.example') {
            const url = new URL('https://proxy.example/api/live-snapshot')
            url.searchParams.set('topic', topic)
            url.searchParams.set('query', query)
            return getLiveSnapshotResponse(new Request(url, { headers: origin ? { origin } : {} }))
        }
        const statuses = []
        statuses.push((await read('foundation', '{}', '')).status)
        statuses.push((await read('foundation', '{}', 'https://attacker.example')).status)
        statuses.push((await read('unknown')).status)
        statuses.push((await read('access-logs', '{')).status)
        statuses.push((await read('access-logs', JSON.stringify({ offset: 15 }))).status)
        statuses.push((await read('access-logs', JSON.stringify({ status: 999 }))).status)
        statuses.push((await read('audit-logs', JSON.stringify({ actorUserId: 'invalid' }))).status)
        statuses.push((await read('foundation', ' '.repeat(4097))).status)
        const rejectedReads = reads
        const response = await read('foundation')
        const cacheControl = response.headers.get('cache-control')
        statuses.push(response.status)
        const application = await (await read('app-events')).json()
        authorized = false
        statuses.push((await read('foundation')).status)
        statuses.push((await read('app-events')).status)
        console.log(JSON.stringify({ statuses, rejectedReads, reads, permissionChecks, cacheControl, application }))
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(code, stderr).toBe(0)
    const result = JSON.parse(stdout)
    expect(result.statuses).toEqual([403, 403, 400, 400, 400, 400, 400, 400, 200, 403, 403])
    expect(result.rejectedReads).toBe(0)
    expect(result.reads).toBe(1)
    expect(result.permissionChecks).toBe(4)
    expect(result.cacheControl).toBe('private, no-store')
    expect(Object.keys(result.application).toSorted()).toEqual(['revision', 'userVersion'])
    expect(result.application.userVersion).toMatch(/^[a-f0-9]{64}$/)
})

test('application events publish immediately, deduplicate Redis echoes and clean up subscribers', async () => {
    const script = `
        const { getApplicationRevision, publishApplicationChange, subscribeToApplicationChanges, receiveApplicationChange, setApplicationPublisher } = await import('./websockets/Helpers/publishFunctions.ts')
        let deliveries = 0
        let published
        const unsubscribe = subscribeToApplicationChanges(() => deliveries++)
        const initial = getApplicationRevision()
        setApplicationPublisher(async event => { published = event })
        publishApplicationChange()
        const changed = getApplicationRevision()
        receiveApplicationChange(published)
        const afterEcho = deliveries
        receiveApplicationChange({ type: 'application.updated', payload: { version: 'remote-write' } })
        const remote = getApplicationRevision()
        unsubscribe()
        setApplicationPublisher(async () => { throw new Error('offline') })
        publishApplicationChange()
        await new Promise(resolve => setTimeout(resolve, 0))
        console.log(JSON.stringify({ initial, changed, afterEcho, deliveries, remote }))
    `
    const child = Bun.spawn([process.execPath, '-e', script], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(code, stderr).toBe(0)
    const result = JSON.parse(stdout)
    expect(result.changed).not.toBe(result.initial)
    expect(result.afterEcho).toBe(1)
    expect(result.deliveries).toBe(2)
    expect(result.remote).toBe('remote-write')
})
