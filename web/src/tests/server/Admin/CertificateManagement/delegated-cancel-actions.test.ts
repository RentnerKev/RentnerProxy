import { expect, test } from 'bun:test'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test('delegated cancellation authorizes operation kind and rejects stale, wrong-mode and late requests before transport', async () => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        const id = '0198d98a-0000-7000-8000-000000000001'
        const operationId = '0198d98a-0000-7000-8000-000000000002'
        let kind = 'issue', stage = 'queued', mode = 'delegated', source = 'acme', state = 'issuing', allowed = true, initialPermission = true, echoKind = null
        const calls = [], writes = [], audits = [], fences = []
        mock.module('./server/Auth/Access/authorization.service.ts', () => ({ requireUserService: async () => ({ id: 'actor', permissions: initialPermission ? ['certificates.issue', 'certificates.renew'] : [] }), requirePermissionService: async () => ({ id: 'actor' }) }))
        mock.module('./server/Auth/Access/rbac.service.ts', () => ({ requirePermissionInTransaction: async (tx, actor, permission) => { fences.push(permission); if (!allowed) throw new Error('permission_denied') } }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({ transaction: async (callback) => callback({}) }) }))
        mock.module('./server/ProxyRuntime/proxy-runtime-settings.ts', () => ({ lockProxyRuntimeSettings: async () => undefined }))
        mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({ reconcileProxyConfigurationWithAudit: async () => 'pending' }))
        mock.module('./server/Admin/CertificateManagement/certificate-metadata-snapshot.server.ts', () => ({ getCertificateMetadataSnapshot: async () => ({ metadata: [] }) }))
        mock.module('./server/Admin/CertificateManagement/certificate-metadata.persistence.ts', () => ({ getCertificateRow: async () => ({ source, operation: state, currentOperation: { id: operationId, kind, dnsMode: mode, stage } }), persistControllerMetadata: async (tx, value) => writes.push(value), persistControllerCertificatesMetadataInTransaction: async () => undefined }))
        mock.module('./server/Controller/certificates.server.ts', () => ({ cancelControllerDelegatedCertificate: async (...args) => { calls.push(args); return { id, currentOperation: { kind: echoKind ?? kind } } }, actOnControllerManualDns: async () => undefined, deleteControllerCertificate: async () => undefined, getControllerCertificate: async () => undefined, importControllerCertificate: async () => undefined, issueControllerCertificate: async () => undefined, renewControllerCertificate: async () => undefined }))
        mock.module('./server/Audit/audit.service.ts', () => ({ appendAuditEventInTransactionService: async (tx, value) => audits.push(value), appendAuditEventsInTransactionService: async () => undefined }))
        mock.module('./server/ProxyRuntime/audit-mutation.ts', () => ({ recordMutationFailureBestEffort: async () => undefined }))
        const { cancelDelegatedCertificateService: cancel } = await import('./server/Admin/CertificateManagement/certificates.service.ts')
        const data = { certificateId: id, operationId }
        const outcomes = []
        for (const value of ['queued', 'creating_order', 'preparing_challenge', 'waiting_for_validation']) { stage = value; outcomes.push(await cancel(data)) }
        kind = 'renew'; state = 'renewing'; outcomes.push(await cancel(data))
        allowed = false; outcomes.push(await cancel(data).catch(e => e.message)); allowed = true
        initialPermission = false; outcomes.push(await cancel(data).catch(e => e.code)); initialPermission = true
        outcomes.push(await cancel({ ...data, operationId: '0198d98a-0000-7000-8000-000000000009' }).catch(e => e.code))
        for (const value of ['provider', 'manual']) { mode = value; outcomes.push(await cancel(data).catch(e => e.code)) }; mode = 'delegated'
        for (const value of ['finalizing', 'certificate_ready', 'applying', 'cancelling', 'cancelled', 'applied']) { stage = value; outcomes.push(await cancel(data).catch(e => e.code)) }; stage = 'queued'
        state = 'idle'; outcomes.push(await cancel(data).catch(e => e.code)); state = 'renewing'
        source = 'manual'; outcomes.push(await cancel(data).catch(e => e.code)); source = 'acme'
        echoKind = 'issue'; outcomes.push(await cancel(data).catch(e => e.code))
        console.log(JSON.stringify({ outcomes, calls, writes, audits, fences }))
    `,
        { cwd: new URL('../../../..', import.meta.url) },
    )
    const result = JSON.parse(output)
    expect(result.outcomes.slice(0, 5)).toEqual(
        Array(5).fill('0198d98a-0000-7000-8000-000000000001'),
    )
    expect(result.outcomes.slice(5, 7)).toEqual(['permission_denied', 'permission_denied'])
    expect(result.outcomes.slice(7, -1)).toEqual(Array(11).fill('operation_in_progress'))
    expect(result.outcomes.at(-1)).toBe('controller_unavailable')
    expect(result.calls).toHaveLength(6)
    expect(result.calls[0]).toEqual([
        '0198d98a-0000-7000-8000-000000000001',
        '0198d98a-0000-7000-8000-000000000002',
    ])
    expect(result.writes).toHaveLength(5)
    expect(result.audits).toHaveLength(5)
    expect(result.fences.slice(0, 4)).toEqual(Array(4).fill('certificates.issue'))
    expect(
        result.fences.slice(4).every((permission: string) => permission === 'certificates.renew'),
    ).toBeTrue()
})
