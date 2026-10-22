import { expect, test } from 'bun:test'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test.each(['getCertificatesService', 'getAssignableCertificatesService'] as const)(
    '%s reauthorizes each joiner on success and controller failure before returning data',
    async (serviceName) => {
        const output = await runBunScript(
            `
            import { mock } from 'bun:test'
            import { createCertificateMetadataSnapshotReader } from './server/Admin/CertificateManagement/certificate-metadata-snapshot.ts'
            const allowed = new Set(['first', 'second'])
            const initialActors = ['first', 'second']
            const fences = []
            const writes = []
            const summaryReads = []
            let revokeAfterPersistence = false
            let requestCount = 0
            let entered = Promise.withResolvers()
            let release = Promise.withResolvers()
            let fail = false
            const readSnapshot = createCertificateMetadataSnapshotReader({
                capture: async () => [],
                readMetadata: async () => { requestCount++; entered.resolve(); await release.promise; if (fail) throw new Error('controller'); return [] },
            })
            const initialActor = async () => ({ id: initialActors.shift(), permissions: ['proxy_hosts.update'] })
            mock.module('./server/Auth/Access/authorization.service.ts', () => ({ requirePermissionService: initialActor, requireUserService: initialActor }))
            mock.module('./server/Auth/Access/rbac.service.ts', () => ({ requirePermissionInTransaction: async (tx, actor, permission) => {
                fences.push([actor, permission]); tx.actor = actor
                if (!allowed.has(actor)) throw new Error('permission_denied')
            } }))
            mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({ transaction: async callback => {
                const tx = { select: () => { summaryReads.push(tx.actor); const query = { from: () => query, orderBy: async () => [], groupBy: async () => [] }; return query } }
                return callback(tx)
            } }) }))
            mock.module('./server/Admin/CertificateManagement/certificate-metadata-snapshot.server.ts', () => ({ getCertificateMetadataSnapshot: readSnapshot }))
            mock.module('./server/Admin/CertificateManagement/certificate-metadata.persistence.ts', () => ({ getCertificateRow: async () => undefined, persistControllerMetadata: async () => undefined, persistControllerCertificatesMetadataInTransaction: async (tx, metadata, markMissing, capture) => { writes.push([tx.actor, markMissing, capture]); if (revokeAfterPersistence) allowed.delete(tx.actor) } }))
            mock.module('./server/ProxyRuntime/proxy-runtime-settings.ts', () => ({ lockProxyRuntimeSettings: async () => undefined }))
            mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({ reconcileProxyConfigurationWithAudit: async () => 'pending' }))
            mock.module('./server/Audit/audit.service.ts', () => ({ appendAuditEventInTransactionService: async () => undefined, appendAuditEventsInTransactionService: async () => undefined }))
            mock.module('./server/ProxyRuntime/audit-mutation.ts', () => ({ recordMutationFailureBestEffort: async () => undefined }))
            const service = (await import('./server/Admin/CertificateManagement/certificates.service.ts'))['${serviceName}']
            const first = service()
            const second = service()
            const outcomes = Promise.allSettled([first, second])
            await entered.promise
            allowed.delete('second')
            release.resolve()
            const results = await outcomes
            const successfulReads = summaryReads.slice()
            // A separate failing request must be fresh, and its revoked actor must
            // receive the authorization failure rather than a shared cached result.
            initialActors.push('first')
            entered = Promise.withResolvers(); release = Promise.withResolvers(); fail = true
            const failing = service().catch(error => error.message)
            await entered.promise; allowed.delete('first'); release.resolve()
            const revokedFailure = await failing
            initialActors.push('first'); allowed.add('first')
            const availableFailure = await service().catch(error => error.code)
            initialActors.push('first'); fail = false; revokeAfterPersistence = true
            const summaryRevoked = await service().catch(error => error.message)
            console.log(JSON.stringify({ results: results.map(result => result.status === 'fulfilled' ? result.value : result.reason.message), writes, fences, successfulReads, summaryReads, requestCount, revokedFailure, availableFailure, summaryRevoked }))
        `,
            { cwd: new URL('../../../..', import.meta.url) },
        )
        const result = JSON.parse(output)
        expect(result.results).toEqual([[], 'permission_denied'])
        expect(result.writes).toEqual([
            ['first', true, []],
            ['first', true, []],
        ])
        expect(result.successfulReads).toEqual(['first', 'first', 'first', 'first'])
        expect(result.summaryReads).toEqual(result.successfulReads)
        expect(result.requestCount).toBe(4)
        expect(result.revokedFailure).toBe('permission_denied')
        expect(result.availableFailure).toBe('controller_unavailable')
        expect(result.summaryRevoked).toBe('permission_denied')
        const permission =
            serviceName === 'getCertificatesService' ? 'certificates.view' : 'proxy_hosts.update'
        expect(result.fences).toEqual([
            ['first', permission],
            ['second', permission],
            ['first', permission],
            ['first', permission],
            ['first', permission],
            ['first', permission],
            ['first', permission],
        ])
    },
)
