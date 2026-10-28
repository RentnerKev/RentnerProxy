import type { DomainDiagnosticsResult } from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
export const domainDiagnosticsInput = {
    hostType: 'proxy' as const,
    hostId: '0198d98a-0000-7000-8000-000000000001',
    domain: 'app.example.com',
}
export const diagnosticRevision = 'sha256:' + 'a'.repeat(64)
export function domainDiagnosticsFixture(): DomainDiagnosticsResult {
    const stage = { durationMs: 1, addresses: [], httpStatus: null }
    return {
        ...domainDiagnosticsInput,
        expectedRevision: diagnosticRevision,
        activeRevision: diagnosticRevision,
        checkedAt: '2026-10-28T10:00:00Z',
        observationPoint: 'appliance',
        publicReachability: 'not_checked',
        stages: {
            configuration: { ...stage, status: 'passed', code: 'configuration_active' },
            dns: {
                ...stage,
                status: 'passed',
                code: 'dns_resolved',
                addresses: ['192.0.2.1', '2001:db8::1'],
            },
            upstream: { ...stage, status: 'passed', code: 'upstream_responded', httpStatus: 200 },
            tls: { ...stage, status: 'passed', code: 'tls_verified' },
        },
    }
}
