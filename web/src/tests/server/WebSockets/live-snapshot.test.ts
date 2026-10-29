import { LIVE_CHANGE_COALESCE_MS } from '@/config/realtime.config.ts'
import {
    getApplicationRevision,
    publishApplicationChange,
    receiveApplicationChange,
    setApplicationPublisher,
    subscribeToApplicationChanges,
} from '@/server/WebSockets/applicationChanges.ts'
import {
    markAuditedApplicationMutation,
    withCommittedApplicationChanges,
} from '@/server/WebSockets/committedChanges.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import { afterEach, expect, mock, test } from 'bun:test'

import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test('live snapshots enforce canonical origin, query limits and current permissions', async () => {
    const script = `
        import { mock } from 'bun:test'
        import { AuthDomainError } from './server/Auth/Core/errors.server.ts'
        let authorized = true
        let authorizationError
        let reads = 0
        let permissionChecks = 0
        mock.module('./server/env.server.ts', () => ({ getPublicOrigin: () => 'https://proxy.example' }))
        mock.module('./server/WebSockets/applicationChanges.ts', () => ({ getApplicationRevision: () => 'revision' }))
        let digestReads = 0
        let runtimeReads = 0
        let crowdSecQuery
        const crowdSecPermissions = []
        const forwardAuthPermissions = []
        mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({ execute: async () => { digestReads++; return [{ digest: 'a'.repeat(64) }] } }) }))
        mock.module('./server/Controller/proxy.server.ts', () => ({ getProxyRuntimeStatus: async () => { runtimeReads++; return { available: true, running: true, activeRevision: 'active', lastApplyAt: null } } }))
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({
            requirePermissionService: async () => {
                permissionChecks++
                if (!authorized) throw authorizationError ?? new AuthDomainError('permission_denied', 'Denied')
                return { id: 'current-user', permissions: ['app.access'] }
            },
        }))
        mock.module('./server/Foundation/health.service.ts', () => ({ checkFoundationHealthService: async () => { reads++; return { database: { state: 'connected' } } } }))
        mock.module('./server/Admin/ProxyAccessLogs/proxy-access-logs.service.ts', () => ({ getProxyAccessLogsService: async (query) => { reads++; return { query, entries: [] } } }))
        mock.module('./server/Audit/audit-reader.service.ts', () => ({ listAuditEventsService: async () => { reads++; return { events: [] } } }))
        mock.module('./server/Admin/ProxyHostManagement/proxy-hosts.service.ts', () => ({ getProxyHostsService: async () => { throw new Error('Bulk proxy read forbidden') } }))
        mock.module('./server/Admin/CertificateManagement/certificates.service.ts', () => ({ getCertificatesService: async () => [] }))
        mock.module('./server/Admin/DnsConnections/dns-connections.service.ts', () => ({ getDnsConnectionsService: async () => {
            const { requirePermissionService } = await import('./server/Auth/Access/authorization.service.ts')
            await requirePermissionService('dns_connections.view'); reads++; return [{ name: 'synthetic connection', zones: ['example.com'] }]
        } }))
        mock.module('./server/Admin/Ddns/ddns.service.ts', () => ({ getDdnsStatusService: async () => {
            const { requirePermissionService } = await import('./server/Auth/Access/authorization.service.ts')
            await requirePermissionService('ddns.view'); reads++; return { internal: 'synthetic target state' }
        } }))
        mock.module('./server/Admin/DockerDiscovery/discovery-management.service.ts', () => ({ getDiscoveryOverviewService: async () => {
            const { requirePermissionService } = await import('./server/Auth/Access/authorization.service.ts')
            await requirePermissionService('docker_discovery.view'); reads++; return { endpoint: 'http://restricted-docker:2375', candidates: [] }
        } }))
        mock.module('./server/Admin/RedirectHostManagement/redirect-hosts.service.ts', () => ({ getRedirectHostsService: async () => { throw new Error('Bulk redirect read forbidden') } }))
        mock.module('./server/Admin/HostTags/host-tags.service.ts', () => ({ getHostTagCatalogService: async () => { throw new Error('Bulk tags read forbidden') } }))
        mock.module('./server/Admin/AccessPolicyManagement/access-policies.service.ts', () => ({ getAccessPoliciesService: async () => { throw new Error('Bulk policy read forbidden') } }))
        mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({ getProxyRuntimeStatusService: async () => { throw new Error('Full runtime snapshot forbidden') } }))
        mock.module('./server/ForwardAuth/forward-auth-summary.service.ts', () => ({
            getForwardAuthSummaryService: async () => {
                const { requirePermissionService } = await import('./server/Auth/Access/authorization.service.ts')
                forwardAuthPermissions.push('access_policies.view')
                await requirePermissionService('access_policies.view')
                return { policyCount: 2, assignedHosts: 8, runtimeState: 'pending' }
            },
        }))
        mock.module('./server/Admin/CrowdSec/crowdsec.service.ts', () => ({
            getCrowdSecConfigurationService: async () => {
                const { requirePermissionService } = await import('./server/Auth/Access/authorization.service.ts')
                crowdSecPermissions.push('crowdsec.view')
                await requirePermissionService('crowdsec.view')
                reads++
                return { mode: 'managed', synchronized: true }
            },
            getCrowdSecDashboardService: async (query) => {
                const { requirePermissionService } = await import('./server/Auth/Access/authorization.service.ts')
                crowdSecPermissions.push('crowdsec.view')
                await requirePermissionService('crowdsec.view')
                reads++
                crowdSecQuery = query
                return { collectedAt: 123, metrics: { blockedRequests: 42 }, decisions: { entries: [] } }
            },
        }))
        const { getLiveSnapshotResponse } = await import('./server/WebSockets/realtimeSnapshots.service.ts')
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
        const validCrowdSecQuery = { offset: 15, limit: 15, search: '203.0.113', origin: 'CAPI', scope: 'Ip' }
        statuses.push((await read('crowdsec-dashboard', '{}')).status)
        statuses.push((await read('crowdsec-dashboard', JSON.stringify({ ...validCrowdSecQuery, limit: 101 }))).status)
        statuses.push((await read('crowdsec-dashboard', JSON.stringify({ ...validCrowdSecQuery, unexpected: true }))).status)
        const rejectedReads = reads
        const response = await read('foundation')
        const cacheControl = response.headers.get('cache-control')
        statuses.push(response.status)
        const application = await (await read('app-events')).json()
        const dnsResponse = await read('dns-connections')
        const ddnsResponse = await read('ddns')
        const discoveryResponse = await read('docker-discovery')
        const dns = await dnsResponse.json()
        const ddns = await ddnsResponse.json()
        const discovery = await discoveryResponse.json()
        const proxy = await (await read('proxy-hosts')).json()
        const redirect = await (await read('redirect-hosts')).json()
        const policy = await (await read('access-policies')).json()
        const crowdSecConfigurationResponse = await read('crowdsec-configuration')
        const crowdSecDashboardResponse = await read('crowdsec-dashboard', JSON.stringify(validCrowdSecQuery))
        const crowdSecConfiguration = await crowdSecConfigurationResponse.json()
        const crowdSecDashboard = await crowdSecDashboardResponse.json()
        const forwardAuthResponse = await read('forward-auth')
        const forwardAuth = await forwardAuthResponse.json()
        authorized = false
        statuses.push((await read('forward-auth')).status)
        statuses.push((await read('crowdsec-configuration')).status)
        statuses.push((await read('crowdsec-dashboard', JSON.stringify(validCrowdSecQuery))).status)
        for (const topic of ['proxy-hosts', 'redirect-hosts', 'access-policies']) statuses.push((await read(topic)).status)
        statuses.push((await read('foundation')).status)
        statuses.push((await read('app-events')).status)
        statuses.push((await read('dns-connections')).status)
        statuses.push((await read('ddns')).status)
        statuses.push((await read('docker-discovery')).status)
        for (const code of ['authentication_required', 'user_not_active', 'service_unavailable']) {
            authorizationError = new AuthDomainError(code, 'Denied')
            statuses.push((await read('foundation')).status)
        }
        authorizationError = new Error('internal failure')
        statuses.push((await read('foundation')).status)
        console.log(JSON.stringify({ statuses, rejectedReads, reads, permissionChecks, digestReads, runtimeReads, proxy, redirect, policy, cacheControl, application, dns, ddns, discovery, dnsCache: dnsResponse.headers.get('cache-control'), ddnsCache: ddnsResponse.headers.get('cache-control'), discoveryCache: discoveryResponse.headers.get('cache-control'), crowdSecConfiguration, crowdSecDashboard, crowdSecQuery, crowdSecPermissions, crowdSecConfigurationCache: crowdSecConfigurationResponse.headers.get('cache-control'), crowdSecDashboardCache: crowdSecDashboardResponse.headers.get('cache-control'), forwardAuth, forwardAuthPermissions, forwardAuthCache: forwardAuthResponse.headers.get('cache-control') }))
    `
    const stdout = await runBunScript(script, { cwd: new URL('../../..', import.meta.url) })
    const result = JSON.parse(stdout)
    expect(result.statuses).toEqual([
        403, 403, 400, 400, 400, 400, 400, 400, 400, 400, 400, 200, 403, 403, 403, 403, 403, 403,
        403, 403, 403, 403, 403, 401, 403, 503, 503,
    ])
    expect(result.rejectedReads).toBe(0)
    expect(result.reads).toBe(6)
    expect(result.permissionChecks).toBe(26)
    expect(result.digestReads).toBe(3)
    expect(result.runtimeReads).toBe(3)
    expect(result.cacheControl).toBe('private, no-store')
    expect(Object.keys(result.application).toSorted()).toEqual(['revision', 'userVersion'])
    expect(result.application.userVersion).toMatch(/^[a-f0-9]{64}$/)
    for (const snapshot of [
        result.dns,
        result.ddns,
        result.discovery,
        result.proxy,
        result.redirect,
        result.policy,
    ]) {
        expect(Object.keys(snapshot)).toEqual(['revision'])
        expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(result.dnsCache).toBe('private, no-store')
    expect(result.discoveryCache).toBe('private, no-store')
    expect(result.ddnsCache).toBe('private, no-store')
    expect(result.crowdSecConfiguration).toEqual({ mode: 'managed', synchronized: true })
    expect(result.crowdSecDashboard.metrics.blockedRequests).toBe(42)
    expect(result.crowdSecQuery).toMatchObject({
        offset: 15,
        limit: 15,
        search: '203.0.113',
        origin: 'CAPI',
        scope: 'Ip',
    })
    expect(result.crowdSecPermissions).toEqual(Array(4).fill('crowdsec.view'))
    expect(result.crowdSecConfigurationCache).toBe('private, no-store')
    expect(result.crowdSecDashboardCache).toBe('private, no-store')
    expect(result.forwardAuth).toEqual({
        policyCount: 2,
        assignedHosts: 8,
        runtimeState: 'pending',
    })
    expect(result.forwardAuthPermissions).toEqual(['access_policies.view', 'access_policies.view'])
    expect(result.forwardAuthCache).toBe('private, no-store')
})

test('application events coalesce notifications, deduplicate Valkey echoes and clean up subscribers', async () => {
    const script = `
        const { LIVE_CHANGE_COALESCE_MS } = await import('./config/realtime.config.ts')
        const { getApplicationRevision, publishApplicationChange, subscribeToApplicationChanges, receiveApplicationChange, setApplicationPublisher } = await import('./server/WebSockets/applicationChanges.ts')
        let deliveries = 0
        let published
        const unsubscribe = subscribeToApplicationChanges(() => deliveries++)
        const initial = getApplicationRevision()
        setApplicationPublisher(async event => { published = event })
        publishApplicationChange()
        const changed = getApplicationRevision()
        await new Promise(resolve => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
        receiveApplicationChange(published)
        const afterEcho = deliveries
        receiveApplicationChange({ type: 'application.updated', payload: { version: 'remote-write' } })
        const remote = getApplicationRevision()
        await new Promise(resolve => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
        unsubscribe()
        setApplicationPublisher(async () => { throw new Error('offline') })
        publishApplicationChange()
        await new Promise(resolve => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
        console.log(JSON.stringify({ initial, changed, afterEcho, deliveries, remote }))
    `
    const stdout = await runBunScript(script, { cwd: new URL('../../..', import.meta.url) })
    const result = JSON.parse(stdout)
    expect(result.changed).not.toBe(result.initial)
    expect(result.afterEcho).toBe(1)
    expect(result.deliveries).toBe(2)
    expect(result.remote).toBe('remote-write')
})

const mutation: AuditEventInput = {
    actorUserId: 'user-1',
    actorKind: 'user',
    action: 'update',
    resource: 'user',
    targetId: 'user-1',
    result: 'success',
}

afterEach(() => {
    const events = globalThis.rentnerproxyRealtimeEvents
    if (events?.notificationTimer) clearTimeout(events.notificationTimer)
    if (events?.publishTimer) clearTimeout(events.publishTimer)
    globalThis.rentnerproxyRealtimeEvents = undefined
})

test('coalesces committed changes into one publication and one sampling notification', async () => {
    const publisher = mock(async () => undefined)
    const listener = mock(() => undefined)
    setApplicationPublisher(publisher)
    const unsubscribe = subscribeToApplicationChanges(listener)
    for (let count = 0; count < 100; count += 1) publishApplicationChange()
    const latest = getApplicationRevision()
    expect(publisher).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
    expect(publisher).toHaveBeenCalledTimes(1)
    expect(publisher).toHaveBeenCalledWith({
        type: 'application.updated',
        payload: { version: latest },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
})

test('coalesces remote event storms and deduplicates their echoed versions', async () => {
    const listener = mock(() => undefined)
    subscribeToApplicationChanges(listener)
    for (let count = 0; count < 100; count += 1) {
        const event = {
            type: 'application.updated' as const,
            payload: { version: `remote-${count}` },
        }
        receiveApplicationChange(event)
        receiveApplicationChange(event)
    }
    await new Promise((resolve) => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
    expect(getApplicationRevision()).toBe('remote-99')
    expect(listener).toHaveBeenCalledTimes(1)
})

test('publishes only after an authenticated mutation commits', async () => {
    const transaction = {}
    const before = getApplicationRevision()
    const result = await withCommittedApplicationChanges(
        async (run) => {
            const committedResult = await run(transaction)
            expect(getApplicationRevision()).toBe(before)
            return committedResult
        },
        async (current) => {
            markAuditedApplicationMutation(current, mutation)
            return 'committed'
        },
    )
    expect(result).toBe('committed')
    expect(getApplicationRevision()).not.toBe(before)
})

test('does not publish rolled back mutations or reuse their markers', async () => {
    const transaction = {}
    const before = getApplicationRevision()
    await expect(
        withCommittedApplicationChanges(
            async (run) => {
                await run(transaction)
                throw new Error('commit failed')
            },
            async (current) => {
                markAuditedApplicationMutation(current, mutation)
            },
        ),
    ).rejects.toThrow('commit failed')
    await withCommittedApplicationChanges(
        (run) => run(transaction),
        async () => undefined,
    )
    expect(getApplicationRevision()).toBe(before)
})

test('does not publish no-ops, rejected requests or unauthenticated audit events', async () => {
    const before = getApplicationRevision()
    await Promise.all(
        [
            undefined,
            { ...mutation, result: 'failure' as const },
            { ...mutation, result: 'denied' as const },
            { ...mutation, actorKind: 'anonymous' as const },
            { ...mutation, actorUserId: null },
            { ...mutation, metadata: { changedFields: [] } },
            { ...mutation, resource: 'config-export' as const },
        ].map((event) =>
            withCommittedApplicationChanges(
                (run) => run({}),
                async (transaction) => {
                    if (event) markAuditedApplicationMutation(transaction, event)
                },
            ),
        ),
    )
    expect(getApplicationRevision()).toBe(before)
})

test('the database adapter promotes only released savepoints and publishes after root commit', async () => {
    const stdout = await runBunScript(
        `
        import { mock } from 'bun:test'
        let failCommit = false
        let failRelease = false
        let commits = 0
        const createTransaction = () => ({
            transaction: async (run) => {
                const result = await run(createTransaction())
                if (failRelease) throw new Error('release failed')
                return result
            },
        })
        const original = {
            marker: 'preserved',
            transaction: async (run) => {
                const result = await run(createTransaction())
                if (failCommit) throw new Error('outer rollback')
                commits++
                return result
            },
        }
        mock.module('./db/index.ts', () => ({ db: original }))
        const { getAuthDatabase } = await import('./server/Auth/Core/database.server.ts')
        const { markAuditedApplicationMutation: mark } = await import('./server/WebSockets/committedChanges.ts')
        const { getApplicationRevision: revision } = await import('./server/WebSockets/applicationChanges.ts')
        const database = getAuthDatabase()
        const event = ${JSON.stringify(mutation)}
        const results = []
        async function attempt(run) {
            const before = revision()
            try { await database.transaction(run) } catch {}
            results.push(revision() !== before)
        }
        // Matches bulk-hosts.storage.server.ts: savepoint(transaction, run) => transaction.transaction(run).
        await attempt(async (outer) => {
            const before = revision()
            await outer.transaction(async (inner) => {
                await inner.transaction(async (deep) => mark(deep, event))
            })
            if (revision() !== before) throw new Error('published before root commit')
        })
        await attempt(async (outer) => {
            try { await outer.transaction(async (inner) => { mark(inner, event); throw new Error('rollback child') }) } catch {}
        })
        await attempt(async (outer) => {
            try { await outer.transaction(async (inner) => { mark(inner, event); throw new Error('rollback child') }) } catch {}
            await outer.transaction(async (sibling) => mark(sibling, event))
        })
        failCommit = true
        await attempt(async (outer) => {
            await outer.transaction(async (inner) => mark(inner, event))
        })
        failCommit = false
        failRelease = true
        await attempt(async (outer) => {
            try { await outer.transaction(async (inner) => mark(inner, event)) } catch {}
        })
        console.log(JSON.stringify({ results, commits, same: database === getAuthDatabase(), marker: database.marker }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    expect(JSON.parse(stdout)).toEqual({
        results: [true, false, true, false, false],
        commits: 4,
        same: true,
        marker: 'preserved',
    })
})
