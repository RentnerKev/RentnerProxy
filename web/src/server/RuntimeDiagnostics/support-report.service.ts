import '@tanstack/react-start/server-only'

import { APP_VERSION } from '@/lib/ApplicationVersion/version.ts'
import { requireUserService } from '@/server/Auth/Access/authorization.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { controllerRequest } from '@/server/Controller/transport.server.ts'
import { getProxyRuntimeStatus } from '@/server/Controller/proxy.server.ts'
import { checkDatabaseHealth } from '@/server/Foundation/database-health.server.ts'
import { checkValkeyHealth } from '@/server/Valkey/health.server.ts'
import {
    canExportRuntimeSupportReport,
    createRuntimeSupportReport,
    serializeRuntimeSupportReport,
} from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import type { RuntimeSupportReport } from '@/lib/RuntimeDiagnostics/Types/runtime-support-report.types.ts'
import {
    readSupportCertificateCounts,
    readSupportCertificateJobCounts,
    readSupportConfigurationCounts,
    readSupportDesiredRevision,
} from './support-report-data.ts'

function value(result: PromiseSettledResult<unknown>): unknown {
    return result.status === 'fulfilled' ? result.value : null
}

export async function exportRuntimeSupportReportService(): Promise<RuntimeSupportReport> {
    const user = await requireUserService()
    if (!canExportRuntimeSupportReport(user.permissions))
        throw new AuthDomainError('permission_denied', 'Permission is required.')

    const capturedAt = new Date()
    const [
        controller,
        caddy,
        database,
        valkey,
        desired,
        runtime,
        configuration,
        certificates,
        jobs,
    ] = await Promise.allSettled([
        controllerRequest('/health', { timeoutMs: 1_200 }),
        controllerRequest('/internal/v1/proxy/version', {
            timeoutMs: 2_000,
            privileged: true,
            allowNotFound: true,
        }),
        checkDatabaseHealth(),
        checkValkeyHealth(),
        readSupportDesiredRevision(),
        getProxyRuntimeStatus(),
        readSupportConfigurationCounts(),
        readSupportCertificateCounts(),
        readSupportCertificateJobCounts(),
    ])
    const report = createRuntimeSupportReport(
        {
            applicationVersion: APP_VERSION,
            controllerHealth: value(controller),
            caddyVersion: value(caddy),
            databaseHealth: value(database),
            valkeyHealth: value(valkey),
            desiredRevision: value(desired),
            runtimeStatus: value(runtime),
            configuration: value(configuration),
            certificates: value(certificates),
            certificateJobs: value(jobs),
        },
        capturedAt,
    )
    serializeRuntimeSupportReport(report)
    return report
}
