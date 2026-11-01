import { expect, test } from 'bun:test'

import { runBunScript } from '@/tests/Helpers/runBunScript.ts'
import { createSubscriptionManager } from '@/server/WebSockets/realtimeSubscriptions.ts'
import type {
    LiveConnectionData,
    LiveTopicSubscription,
} from '@/server/WebSockets/Types/realtime-subscriptions.types.ts'

const maintenance = {
    id: '01900000-0000-7000-8000-000000000001',
    requestId: '01900000-0000-7000-8000-000000000002',
    actorId: '01900000-0000-7000-8000-000000000003',
    actorName: 'Restore operator',
    artifactId: '01900000-0000-7000-8000-000000000004',
    metadataSha256: 'a'.repeat(64),
    operation: 'restore',
    state: 'running',
    phase: 'database',
    progressPercent: 40,
    requestedAt: 100,
    startedAt: 110,
    finishedAt: null,
    error: null,
}

test('restore snapshots use application access and disclose only maintenance; fenced reads use only cached authentication', async () => {
    const stdout = await runBunScript(
        `
        import { mock } from 'bun:test'
        import { AuthDomainError } from './server/Auth/Core/errors.server.ts'
        const maintenance = ${JSON.stringify(maintenance)}
        let fenced = false
        let cached = false
        let authorized = true
        let statusError = false
        let operation = 'restore'
        let normalAuthCalls = 0
        let controllerReads = 0
        let ordinaryReads = 0
        let cacheChecks = 0
        const permissions = []
        const requirePermission = async permission => {
            normalAuthCalls++
            permissions.push(permission)
            if (!authorized) throw new AuthDomainError('authentication_required', 'Denied')
            if (permission !== 'app.access') throw new AuthDomainError('permission_denied', 'Denied')
            return { id: 'viewer', permissions: ['app.access'] }
        }
        mock.module('./server/env.server.ts', () => ({ getPublicOrigin: () => 'https://proxy.example' }))
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({ requirePermissionService: requirePermission }))
        mock.module('./server/WebSockets/applicationChanges.ts', () => ({ getApplicationRevision: () => 'current' }))
        mock.module('./server/Backups/restore-maintenance.server.ts', () => ({
            getActiveRestoreMaintenance: async () => {
                if (statusError) throw new Error('Malformed root maintenance status')
                return fenced ? maintenance : null
            },
            isRestoreMaintenanceFenced: () => fenced,
            authorizeMaintenanceSnapshot: () => { cacheChecks++; return cached },
        }))
        mock.module('./server/Admin/Backups/backups.service.ts', () => ({ getBackupsStatusService: async () => { ordinaryReads++; await requirePermission('backups.view'); return { privateConfiguration: true } } }))
        mock.module('./server/Admin/Backups/backups-demo.server.ts', () => ({ getLocalBackupDemoStatus: async () => null }))
        mock.module('./server/Controller/backups.server.ts', () => ({ backupsController: { maintenance: async () => { controllerReads++; return { ...maintenance, operation } } } }))
        const failRead = async () => { ordinaryReads++; throw new Error('Ordinary database/controller read during maintenance') }
        const modules = {
            './server/Admin/ProxyAccessLogs/proxy-access-logs.service.ts': ['getProxyAccessLogsService'],
            './server/Audit/audit-reader.service.ts': ['listAuditEventsService'],
            './server/Foundation/health.service.ts': ['checkFoundationHealthService'],
            './server/Admin/CertificateManagement/certificates.service.ts': ['getCertificatesService'],
            './server/Admin/DnsConnections/dns-connections.service.ts': ['getDnsConnectionsService'],
            './server/Admin/Ddns/ddns.service.ts': ['getDdnsStatusService'],
            './server/Admin/DockerDiscovery/discovery-management.service.ts': ['getDiscoveryOverviewService'],
            './server/WebSockets/proxy-live-revision.server.ts': ['getProxyLiveRevisionService'],
            './server/ForwardAuth/forward-auth-summary.service.ts': ['getForwardAuthSummaryService'],
            './server/Admin/CrowdSec/crowdsec.service.ts': ['getCrowdSecConfigurationService', 'getCrowdSecDashboardService'],
        }
        for (const [path, exports] of Object.entries(modules))
            mock.module(path, () => Object.fromEntries(exports.map(name => [name, failRead])))
        const { getLiveSnapshotResponse } = await import('./server/WebSockets/realtimeSnapshots.service.ts')
        const read = async (topic, origin = 'https://proxy.example') => {
            const response = await getLiveSnapshotResponse(new Request('https://proxy.example/api/live-snapshot?topic=' + topic, { headers: { origin } }))
            return { status: response.status, body: await response.text(), cache: response.headers.get('cache-control') }
        }
        const publicViewer = await read('backup-restore')
        const deniedFullStatus = await read('backups')
        authorized = false
        const anonymous = await read('backup-restore')
        const readsAfterAnonymous = controllerReads
        const foreignOrigin = await read('backup-restore', 'https://foreign.example')
        authorized = true
        operation = 'delete'
        const deletion = await read('backup-restore')
        const beforeFence = { normalAuthCalls, controllerReads, ordinaryReads }
        fenced = true
        const uncached = await read('backup-restore')
        cached = true
        authorized = false
        const cachedViewer = await read('backup-restore')
        const suspended = []
        for (const topic of ['app-events', 'foundation', 'backups', 'proxy-hosts', 'certificates', 'dns-connections', 'access-logs', 'audit-logs', 'crowdsec-dashboard', 'forward-auth'])
            suspended.push(await read(topic))
        const afterFence = { normalAuthCalls, controllerReads, ordinaryReads }
        statusError = true
        const invalidProgress = await read('backup-restore')
        console.log(JSON.stringify({ publicViewer, deniedFullStatus, anonymous, readsAfterAnonymous, foreignOrigin, deletion, beforeFence, uncached, cachedViewer, suspended, afterFence, invalidProgress, permissions, cacheChecks }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    const result = JSON.parse(stdout)
    expect(result.publicViewer.status).toBe(200)
    expect(JSON.parse(result.publicViewer.body)).toEqual({ maintenance })
    expect(result.publicViewer.cache).toBe('private, no-store')
    expect(result.deniedFullStatus.status).toBe(403)
    expect(result.anonymous).toMatchObject({ status: 401, body: '' })
    expect(result.readsAfterAnonymous).toBe(1)
    expect(result.foreignOrigin).toMatchObject({ status: 403, body: '' })
    expect(JSON.parse(result.deletion.body)).toEqual({ maintenance: null })
    expect(result.permissions).toEqual(['app.access', 'backups.view', 'app.access', 'app.access'])
    expect(result.uncached).toMatchObject({ status: 503, body: '' })
    expect(JSON.parse(result.cachedViewer.body)).toEqual({ maintenance })
    expect(result.cachedViewer.status).toBe(200)
    for (const snapshot of result.suspended) {
        expect(snapshot.status).toBe(200)
        expect(JSON.parse(snapshot.body)).toEqual({ maintenanceSuspended: true })
    }
    expect(result.afterFence).toEqual(result.beforeFence)
    expect(result.invalidProgress).toMatchObject({ status: 503, body: '' })
    expect(result.cacheChecks).toBe(12)
})

test('subscription sampling keeps ordinary data unchanged while sending restore progress and completion', async () => {
    let suspended = true
    let progress = 40
    const sent: Array<unknown> = []
    const closures: Array<string> = []
    const manager = createSubscriptionManager({
        maxPayloadBytes: 4096,
        snapshotTimeoutMs: 1000,
        readSnapshot: async (subscription) => ({
            kind: 'success',
            data:
                subscription.topic === 'backup-restore'
                    ? {
                          maintenance: {
                              ...maintenance,
                              progressPercent: progress,
                              state: progress === 100 ? 'succeeded' : 'running',
                          },
                      }
                    : suspended
                      ? { maintenanceSuspended: true }
                      : { revision: 'restored' },
        }),
        closeUnauthorized: () => {
            closures.push('unauthorized')
        },
        closeUnavailable: () => {
            closures.push('unavailable')
        },
        closeBackpressured: () => {
            closures.push('backpressured')
        },
    })
    const connection: LiveConnectionData = {
        requestUrl: 'https://proxy.example/api/live',
        cookie: null,
        origin: 'https://proxy.example',
        ws: {
            sendText: (message: string) => {
                sent.push(JSON.parse(message))
                return message.length
            },
        } as LiveConnectionData['ws'],
        closed: false,
        handshakeAbortController: null,
        subscriptions: new Map(),
        messageWindowStarted: 0,
        messageCount: 0,
    }
    const subscription = (topic: LiveTopicSubscription['topic']): LiveTopicSubscription => ({
        connection,
        topic,
        query: {},
        queryText: '{}',
        intervalMs: 500,
        timer: null,
        abortController: null,
        abortTimer: null,
        inflight: false,
        pending: false,
        lastComparison: 'previous-comparison',
        active: true,
    })
    const ordinary = subscription('app-events')
    const restore = subscription('backup-restore')
    await manager.sample(ordinary)
    expect(sent).toHaveLength(0)
    expect(ordinary.lastComparison).toBe('previous-comparison')
    expect(ordinary.inflight).toBe(false)
    expect(ordinary.abortTimer).toBeNull()
    await manager.sample(restore)
    progress = 100
    await manager.sample(restore)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({
        topic: 'backup-restore',
        payload: { maintenance: { state: 'running', progressPercent: 40 } },
    })
    expect(sent[1]).toMatchObject({
        topic: 'backup-restore',
        payload: { maintenance: { state: 'succeeded', progressPercent: 100 } },
    })
    suspended = false
    await manager.sample(ordinary)
    expect(sent).toHaveLength(3)
    expect(sent[2]).toMatchObject({ topic: 'app-events', payload: { revision: 'restored' } })
    expect(closures).toEqual([])
})

test('restart workers wait for the matching restore success and a queued shutdown drains without starting writers', async () => {
    const stdout = await runBunScript(
        `
        import { mock } from 'bun:test'
        const maintenance = ${JSON.stringify(maintenance)}
        let status = { ...maintenance, phase: 'restarting' }
        mock.module('./server/Backups/restore-maintenance-status.server.ts', () => ({ readRestoreMaintenanceStatus: async () => status }))
        const { startWorkerLifecycle, stopWorkersForRestoreMaintenance } = await import('./server/Foundation/worker-lifecycle.server.ts')
        const originalTimeout = globalThis.setTimeout
        const waits = []
        globalThis.setTimeout = callback => { waits.push(callback); return 1 }
        const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve() }
        const calls = []
        const initializing = startWorkerLifecycle(async () => ({ start: () => calls.push('start'), stop: async () => { calls.push('stop') } }))
        await flush()
        const beforeSuccess = []
        for (const next of [{ ...maintenance, phase: 'restarting', state: 'failed' }, null, { ...maintenance, id: 'different-operation', state: 'succeeded' }]) {
            status = next
            waits.shift()()
            await flush()
            beforeSuccess.push([...calls])
        }
        status = { ...maintenance, phase: 'complete', state: 'succeeded' }
        waits.shift()()
        await initializing
        const afterSuccess = [...calls]
        status = { ...maintenance, state: 'queued', phase: 'queued' }
        const pendingStartup = startWorkerLifecycle(async () => ({ start: () => calls.push('queued-start'), stop: async () => { calls.push('queued-stop') } }))
        await flush()
        const draining = stopWorkersForRestoreMaintenance()
        waits.shift()()
        await Promise.all([pendingStartup, draining])
        globalThis.setTimeout = originalTimeout
        console.log(JSON.stringify({ beforeSuccess, afterSuccess, calls }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    const result = JSON.parse(stdout)
    expect(result.beforeSuccess).toEqual([[], [], []])
    expect(result.afterSuccess).toEqual(['start'])
    expect(result.calls).toEqual(['start', 'stop', 'queued-stop'])
})
