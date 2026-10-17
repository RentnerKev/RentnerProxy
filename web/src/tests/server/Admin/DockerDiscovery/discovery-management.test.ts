import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { DISCOVERY_ACTOR, DISCOVERY_HOST } from '@/tests/Helpers/discoveryFixture.ts'

test('management protects activation previews, actors, revisions, detachment and uncertain cross-component writes', async () => {
    const script = `
        import assert from 'node:assert/strict'
        import { mock } from 'bun:test'
        import { PERMISSIONS } from './config/permissions.config.ts'
        import { AuthDomainError } from './server/Auth/Core/errors.server.ts'
        import { discoveryRegistry, discoverySnapshot } from './tests/Helpers/discoveryFixture.ts'
        const DISCOVERY_ACTOR = ${JSON.stringify(DISCOVERY_ACTOR)}
        const DISCOVERY_HOST = ${JSON.stringify(DISCOVERY_HOST)}
        let grants = new Set(Object.values(PERMISSIONS))
        let registry = discoveryRegistry()
        let snapshot = discoverySnapshot()
        let controllerReads = 0
        let writeFails = false
        let transactionDenied = false
        let rateLimited = false
        const audits = []
        const writes = []
        async function permission(key, transactional = false) {
            if (!grants.has(key) || (transactional && transactionDenied)) throw new AuthDomainError('permission_denied', 'Denied')
            return { id: DISCOVERY_ACTOR, permissions: [...grants] }
        }
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({ requirePermissionService: key => permission(key) }))
        mock.module('./server/Auth/Access/rbac.service.ts', () => ({ requirePermissionInTransaction: (_tx, _actor, key) => permission(key, true) }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({ transaction: async operation => {
            const before = structuredClone(registry)
            try { return await operation({}) } catch (error) { registry = before; throw error }
        } }) }))
        mock.module('./server/ProxyRuntime/proxy-runtime-settings.ts', () => ({ lockProxyRuntimeSettings: async () => {} }))
        mock.module('./server/ProxyRuntime/proxy-runtime-data.ts', () => ({ readProxyRuntimeSnapshot: async () => assert.fail('management must not apply runtime state') }))
        mock.module('./server/Valkey/rate-limiter.service.ts', () => ({ consumeRateLimit: async () => {
            if (rateLimited) throw new Error('rate limited')
        } }))
        mock.module('./server/Audit/audit.service.ts', () => ({ appendAuditEventInTransactionService: async (_tx, value) => { audits.push(value) }, recordAuditEventBestEffortService: async value => { audits.push(value) } }))
        mock.module('./server/Admin/DockerDiscovery/discovery-worker.ts', () => ({ dockerDiscoveryWorker: { trigger: async () => {} } }))
        mock.module('./server/Admin/ProxyHostManagement/proxy-hosts.mutations.server.ts', () => ({
            createProxyHostInTransaction: async () => assert.fail('management must not bypass the reconciliation worker'),
            updateProxyHostInTransaction: async () => assert.fail('management must not bypass the reconciliation worker'),
        }))
        mock.module('./server/Admin/DockerDiscovery/discovery-inventory.server.ts', () => ({ readDiscoveryInventory: async () => ({ hosts: [], domains: [] }) }))
        mock.module('./server/Admin/DockerDiscovery/discovery-storage.server.ts', () => ({
            readDiscoveryRegistry: async () => structuredClone(registry),
            writeDiscoveryRegistry: async (_tx, value) => { if (writeFails) throw new Error('SYNTHETIC_PRIVATE_STORE_ERROR'); registry = structuredClone(value) },
            assertDiscoveryHostEditable: async () => {},
        }))
        mock.module('./server/Controller/docker-discovery.server.ts', () => ({ dockerDiscoveryController: {
            status: async () => { controllerReads++; return structuredClone(snapshot) },
            save: async input => {
                assert.equal(input.actorUserId, DISCOVERY_ACTOR)
                assert.equal(input.expectedRevision, snapshot.configuration.revision)
                writes.push(input)
                snapshot.configuration = { version: 1, revision: input.expectedRevision + 1, settings: input.configuration }
                return structuredClone(snapshot)
            },
            inspect: async input => { assert.equal(input.actorUserId, DISCOVERY_ACTOR); return { candidates: [] } },
        } }))
        const service = await import('./server/Admin/DockerDiscovery/discovery-management.service.ts')
        const { reconcileDiscoveryInTransaction } = await import('./server/Admin/DockerDiscovery/discovery-reconcile.server.ts')
        const { discoveryEndpointHash } = await import('./server/Admin/DockerDiscovery/discovery-plan.ts')
        grants.delete(PERMISSIONS.DOCKER_DISCOVERY_VIEW)
        await assert.rejects(service.getDiscoveryOverviewService(), /Denied/)
        assert.equal(controllerReads, 0)
        grants.add(PERMISSIONS.DOCKER_DISCOVERY_VIEW)
        const connection = { expectedRevision: 0, connectorRevision: snapshot.configuration.revision, endpoint: 'http://docker-proxy:2375', acknowledgeRestore: false }
        grants.delete(PERMISSIONS.DOCKER_DISCOVERY_MANAGE)
        await assert.rejects(service.connectDiscoveryService(connection), /Denied/)
        assert.equal(writes.length, 0)
        grants.add(PERMISSIONS.DOCKER_DISCOVERY_MANAGE)
        rateLimited = true
        await assert.rejects(service.connectDiscoveryService(connection), /rate limited/)
        assert.equal(writes.length, 0)
        rateLimited = false
        let overview = await service.getDiscoveryOverviewService()
        assert.deepEqual(overview.changes, { create: 1, update: 0 })
        assert.equal(overview.management.actorUserId, undefined)
        assert.equal(overview.management.endpointHash, undefined)
        await assert.rejects(service.changeDiscoveryService({ expectedRevision: 0, action: 'enable', previewToken: 'a'.repeat(64) }), /conflict/)
        grants.delete(PERMISSIONS.PROXY_HOSTS_APPLY)
        await assert.rejects(service.changeDiscoveryService({ expectedRevision: 0, action: 'enable', previewToken: overview.previewToken }), /permission/)
        grants.add(PERMISSIONS.PROXY_HOSTS_APPLY)
        const enabled = await service.changeDiscoveryService({ expectedRevision: 0, action: 'enable', previewToken: overview.previewToken })
        assert.deepEqual(enabled, { revision: 1 })
        assert.equal(registry.actorUserId, DISCOVERY_ACTOR)
        transactionDenied = true
        await assert.rejects(service.changeDiscoveryService({ expectedRevision: 1, action: 'disable' }), /Denied/)
        assert.equal(registry.enabled, true)
        transactionDenied = false
        const owner = { key: 'a'.repeat(64), sourceId: 'name:app', hostId: DISCOVERY_HOST, containerId: 'a'.repeat(64), domains: ['app.example.com'], state: 'managed', error: null }
        registry.owners.push(owner)
        await service.changeDiscoveryService({ expectedRevision: 1, action: 'detach', key: owner.key })
        assert.equal(registry.owners[0].state, 'detached')
        assert.equal(registry.owners[0].hostId, DISCOVERY_HOST)
        await service.changeDiscoveryService({ expectedRevision: 2, action: 'disable' })
        assert.equal(registry.enabled, false)
        assert.equal(registry.owners.length, 1)
        await service.changeDiscoveryService({ expectedRevision: 3, action: 'disconnect' })
        assert.equal(snapshot.configuration.settings.enabled, false)
        assert.equal(registry.enabled, false)
        assert.equal(registry.actorUserId, null)
        assert.equal(registry.owners[0].hostId, DISCOVERY_HOST)
        assert.equal(registry.owners[0].state, 'detached')
        const forged = { endpoint: 'http://docker-proxy:2375', actorUserId: 'forged' }
        await assert.rejects(service.inspectDiscoveryService(forged), /invalid_input/)
        await service.inspectDiscoveryService({ endpoint: 'http://docker-proxy:2375' })
        const old = structuredClone(registry)
        old.enabled = true; old.actorUserId = DISCOVERY_ACTOR; old.connectorRevision = snapshot.configuration.revision; old.endpointHash = discoveryEndpointHash(snapshot.configuration.settings.endpoint)
        registry = old
        writeFails = true
        await assert.rejects(service.connectDiscoveryService({ expectedRevision: registry.revision, connectorRevision: snapshot.configuration.revision, endpoint: 'http://other-engine:2375', acknowledgeRestore: false }), /SYNTHETIC_PRIVATE_STORE_ERROR/)
        assert.equal(registry.enabled, true)
        assert.notEqual(registry.connectorRevision, snapshot.configuration.revision)
        assert.equal(await reconcileDiscoveryInTransaction({}, registry, snapshot), false)
        assert.equal(audits.some(event => event.result === 'failure'), true)
        assert.equal(JSON.stringify(audits).includes('http://'), false)
        assert.equal(JSON.stringify(audits).includes('PRIVATE'), false)
        console.log(JSON.stringify({ protected: true, uncertainWriteBlocked: true, writes: writes.length }))
    `
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        env: {
            ...process.env,
            DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit',
        },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({
        protected: true,
        uncertainWriteBlocked: true,
        writes: 2,
    })
})
