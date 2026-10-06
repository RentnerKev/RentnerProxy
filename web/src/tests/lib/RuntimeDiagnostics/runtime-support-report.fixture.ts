import {
    CERTIFICATE_ERROR_CODES,
    CERTIFICATE_OPERATIONS,
    CERTIFICATE_OPERATION_STAGES,
    CERTIFICATE_STORED_STATUSES,
} from '@/config/certificates.config.ts'
import { CERTIFICATE_JOB_STAGES } from '@/config/certificate-jobs.config.ts'
import { SUPPORT_CERTIFICATE_JOB_ERROR_CODES } from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import { CONTROLLER_SERVICE } from '@/config/controller.config.ts'
import type { RuntimeSupportReportInput } from '@/lib/RuntimeDiagnostics/Types/runtime-support-report.types.ts'

export const SUPPORT_FIXTURE_REVISION = 'sha256:' + 'a'.repeat(64)

function counters(keys: readonly string[], selected: string): Record<string, number> {
    return Object.fromEntries(keys.map((key) => [key, key === selected ? 1 : 0]))
}

export function supportReportFixture(): RuntimeSupportReportInput {
    return {
        applicationVersion: '1.0.0-beta.1',
        controllerHealth: { status: 'ok', service: CONTROLLER_SERVICE, version: '1.0.0-beta.1' },
        caddyVersion: { version: 'v2.10.2' },
        databaseHealth: { state: 'connected' },
        valkeyHealth: { state: 'connected' },
        desiredRevision: SUPPORT_FIXTURE_REVISION,
        runtimeStatus: {
            available: true,
            running: true,
            activeRevision: SUPPORT_FIXTURE_REVISION,
            lastApplyAt: '2026-10-06T08:00:00Z',
        },
        configuration: {
            proxyHosts: { total: 2, enabled: 1 },
            redirectHosts: { total: 1, enabled: 1 },
        },
        certificates: {
            total: 1,
            storedStatuses: counters([...CERTIFICATE_STORED_STATUSES, 'other'], 'valid'),
            operations: counters([...CERTIFICATE_OPERATIONS, 'other'], 'idle'),
            operationStages: counters([...CERTIFICATE_OPERATION_STAGES, 'none', 'other'], 'none'),
            errors: counters([...CERTIFICATE_ERROR_CODES, 'none', 'other'], 'none'),
        },
        certificateJobs: {
            total: 1,
            stages: counters([...CERTIFICATE_JOB_STAGES, 'other'], 'applied'),
            controllerStages: counters(
                [...CERTIFICATE_OPERATION_STAGES, 'none', 'other'],
                'applied',
            ),
            errors: counters([...SUPPORT_CERTIFICATE_JOB_ERROR_CODES, 'none', 'other'], 'none'),
        },
    }
}
