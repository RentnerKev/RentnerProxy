import { expect, test } from 'bun:test'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test('manual DNS actions authorize the operation kind and fence stale or active challenge sets before controller calls', async () => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        const id = '0198d98a-0000-7000-8000-000000000001'
        const operationId = '0198d98a-0000-7000-8000-000000000002'
        const challengeSetId = '0198d98a-0000-7000-8000-000000000003'
        let kind = 'issue'; let status = 'awaiting_input'; let allowed = true; let source = 'acme'; let fences = []; let calls = []; let writes = []; let audits = []
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({ requireUserService: async () => ({ id: 'actor', permissions: ['certificates.issue', 'certificates.renew'] }), requirePermissionService: async () => ({ id: 'actor', permissions: ['certificates.issue', 'certificates.renew'] }) }))
        mock.module('./server/Auth/Access/rbac.service.ts', () => ({ requirePermissionInTransaction: async (tx, actor, permission) => { fences.push(permission); if (!allowed) throw new Error('permission_denied') } }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({ transaction: async (callback) => callback({}) }) }))
        mock.module('./server/ProxyRuntime/proxy-runtime-settings.ts', () => ({ lockProxyRuntimeSettings: async () => undefined }))
        mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({ reconcileProxyConfigurationWithAudit: async () => 'pending' }))
        mock.module('./server/Admin/CertificateManagement/certificate-metadata-snapshot.server.ts', () => ({ getCertificateMetadataSnapshot: async () => ({ metadata: [] }) }))
        mock.module('./server/Admin/CertificateManagement/certificate-metadata.persistence.ts', () => ({ getCertificateRow: async () => ({ source, currentOperation: { id: operationId, kind, dnsMode: 'manual', manualDns: { challengeSetId, status } } }), persistControllerMetadata: async (tx, value) => writes.push(value), persistControllerCertificatesMetadataInTransaction: async () => undefined }))
        mock.module('./server/Controller/certificates.server.ts', () => ({ actOnControllerManualDns: async (...args) => { calls.push(args); return { id, operation: 'renewing' } }, deleteControllerCertificate: async () => undefined, getControllerCertificate: async () => undefined, importControllerCertificate: async () => undefined, issueControllerCertificate: async () => undefined, renewControllerCertificate: async () => undefined }))
        mock.module('./server/Audit/audit.service.ts', () => ({ appendAuditEventInTransactionService: async (tx, value) => audits.push(value), appendAuditEventsInTransactionService: async () => undefined }))
        mock.module('./server/ProxyRuntime/audit-mutation.ts', () => ({ recordMutationFailureBestEffort: async () => undefined }))
        const { actOnManualDnsService } = await import('./server/Admin/CertificateManagement/certificates.service.ts')
        const data = { certificateId: id, operationId, challengeSetId }
        const outcomes = []
        outcomes.push(await actOnManualDnsService(data, 'continue'))
        kind = 'renew'; outcomes.push(await actOnManualDnsService(data, 'cancel'))
        allowed = false; outcomes.push(await actOnManualDnsService(data, 'continue').catch(e => e.message)); allowed = true
        outcomes.push(await actOnManualDnsService({ ...data, operationId: '0198d98a-0000-7000-8000-000000000009' }, 'continue').catch(e => e.code))
        outcomes.push(await actOnManualDnsService({ ...data, challengeSetId: '0198d98a-0000-7000-8000-000000000009' }, 'cancel').catch(e => e.code))
        for (const value of ['checking_dns', 'validating', 'complete', 'expired', 'cancelled']) { status = value; outcomes.push(await actOnManualDnsService(data, 'cancel').catch(e => e.code)) }
        status = 'awaiting_input'; source = 'manual'; outcomes.push(await actOnManualDnsService(data, 'continue').catch(e => e.code))
        console.log(JSON.stringify({ outcomes, calls, writes, fences, audits }))
    `,
        { cwd: new URL('../../../..', import.meta.url) },
    )
    const result = JSON.parse(output)
    expect(result.outcomes.slice(0, 3)).toEqual([
        '0198d98a-0000-7000-8000-000000000001',
        '0198d98a-0000-7000-8000-000000000001',
        'permission_denied',
    ])
    expect(result.outcomes.slice(3)).toEqual(Array(8).fill('operation_in_progress'))
    expect(result.calls).toHaveLength(2)
    expect(result.calls[0]).toEqual([
        '0198d98a-0000-7000-8000-000000000001',
        'continue',
        {
            operationId: '0198d98a-0000-7000-8000-000000000002',
            challengeSetId: '0198d98a-0000-7000-8000-000000000003',
        },
    ])
    expect(result.calls[1][1]).toBe('cancel')
    expect(result.fences[0]).toBe('certificates.issue')
    expect(result.fences.slice(1)).toEqual(Array(10).fill('certificates.renew'))
    expect(result.writes).toHaveLength(2)
    expect(result.audits).toHaveLength(2)
})
