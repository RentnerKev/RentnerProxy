import {
    MAX_RUNTIME_SUPPORT_REPORT_BYTES,
    MAX_RUNTIME_SUPPORT_REPORT_COUNT,
    RUNTIME_SUPPORT_REPORT_FORMAT,
    RUNTIME_SUPPORT_REPORT_VERSION,
} from '@/config/runtime-support-report.config.ts'
import {
    CERTIFICATE_ERROR_CODES,
    CERTIFICATE_OPERATIONS,
    CERTIFICATE_OPERATION_STAGES,
    CERTIFICATE_STORED_STATUSES,
} from '@/config/certificates.config.ts'
import { CERTIFICATE_JOB_STAGES } from '@/config/certificate-jobs.config.ts'
import { RUNTIME_SUPPORT_REPORT_PERMISSIONS } from '@/config/permissions.config.ts'
import { CONTROLLER_SERVICE } from '@/config/controller.config.ts'
import { isRecord } from '@/lib/Records/isRecord.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type {
    RuntimeSupportReport,
    RuntimeSupportReportInput,
    SupportCertificateCounts,
    SupportHostCounts,
    SupportJobCounts,
    SupportReportSection,
    SupportVersion,
} from './Types/runtime-support-report.types.ts'

export const SUPPORT_CERTIFICATE_JOB_ERROR_CODES = [
    ...CERTIFICATE_ERROR_CODES,
    'host_changed',
    'host_deleted',
    'permission_revoked',
    'certificate_deleted',
    'certificate_used_elsewhere',
    'idempotency_conflict',
    'job_not_found',
] as const

export function canExportRuntimeSupportReport(permissions: readonly PermissionKey[]): boolean {
    return RUNTIME_SUPPORT_REPORT_PERMISSIONS.every((permission) =>
        permissions.includes(permission),
    )
}

function version(value: unknown): SupportVersion {
    // Arbitrary semver prerelease/build strings can contain private deployment names.
    const valid =
        typeof value === 'string' &&
        value.length <= 64 &&
        /^v?\d{1,9}\.\d{1,9}\.\d{1,9}(?:-(?:dev|alpha|beta|rc|preview)(?:[.-](?:\d{1,9}|[a-f0-9]{7,40}))?)?$/u.test(
            value,
        )
    return valid
        ? { state: 'available', value: value.replace(/^v/u, '') }
        : { state: 'unavailable', value: null }
}

function revision(value: unknown): string | null {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value) ? value : null
}

function timestamp(value: unknown): string | null {
    if (
        typeof value !== 'string' ||
        value.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    )
        return null
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function count(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= MAX_RUNTIME_SUPPORT_REPORT_COUNT
    )
}

function counters(value: unknown, keys: readonly string[]): Record<string, number> | null {
    if (!isRecord(value)) return null
    const result: Record<string, number> = {}
    for (const key of keys) {
        const item = value[key]
        if (!count(item)) return null
        result[key] = item
    }
    return result
}

function hostCounts(value: unknown): SupportHostCounts | null {
    if (!isRecord(value) || !count(value.total) || !count(value.enabled)) return null
    if (value.enabled > value.total) return null
    return { total: value.total, enabled: value.enabled }
}

function certificateCounts(value: unknown): SupportCertificateCounts | null {
    if (!isRecord(value) || !count(value.total)) return null
    const storedStatuses = counters(value.storedStatuses, [...CERTIFICATE_STORED_STATUSES, 'other'])
    const operations = counters(value.operations, [...CERTIFICATE_OPERATIONS, 'other'])
    const operationStages = counters(value.operationStages, [
        ...CERTIFICATE_OPERATION_STAGES,
        'none',
        'other',
    ])
    const errors = counters(value.errors, [...CERTIFICATE_ERROR_CODES, 'none', 'other'])
    if (!storedStatuses || !operations || !operationStages || !errors) return null
    if (
        [storedStatuses, operations, operationStages, errors].some(
            (group) => Object.values(group).reduce((sum, item) => sum + item, 0) !== value.total,
        )
    )
        return null
    return { total: value.total, storedStatuses, operations, operationStages, errors }
}

function jobCounts(value: unknown): SupportJobCounts | null {
    if (!isRecord(value) || !count(value.total)) return null
    const stages = counters(value.stages, [...CERTIFICATE_JOB_STAGES, 'other'])
    const controllerStages = counters(value.controllerStages, [
        ...CERTIFICATE_OPERATION_STAGES,
        'none',
        'other',
    ])
    const errors = counters(value.errors, [...SUPPORT_CERTIFICATE_JOB_ERROR_CODES, 'none', 'other'])
    if (!stages || !controllerStages || !errors) return null
    if (
        [stages, controllerStages, errors].some(
            (group) => Object.values(group).reduce((sum, item) => sum + item, 0) !== value.total,
        )
    )
        return null
    return { total: value.total, stages, controllerStages, errors }
}

function section<T>(data: T | null): SupportReportSection<T> {
    return { state: data === null ? 'unavailable' : 'available', data }
}

function connected(value: unknown): 'connected' | 'unavailable' {
    return isRecord(value) && value.state === 'connected' ? 'connected' : 'unavailable'
}

/** Construct every field afresh. Never serialize, redact, or spread source payloads. */
export function createRuntimeSupportReport(
    input: RuntimeSupportReportInput,
    capturedAt: Date,
): RuntimeSupportReport {
    const controllerConnected =
        isRecord(input.controllerHealth) &&
        input.controllerHealth.status === 'ok' &&
        input.controllerHealth.service === CONTROLLER_SERVICE
    const application = version(input.applicationVersion)
    const controller = version(
        controllerConnected && isRecord(input.controllerHealth)
            ? input.controllerHealth.version
            : null,
    )
    const caddy = version(isRecord(input.caddyVersion) ? input.caddyVersion.version : null)
    const runtime = isRecord(input.runtimeStatus) ? input.runtimeStatus : null
    const desiredRevision = revision(input.desiredRevision)
    const appliedRevision = revision(runtime?.activeRevision)
    const available = typeof runtime?.available === 'boolean' ? runtime.available : null
    const running = typeof runtime?.running === 'boolean' ? runtime.running : null
    const runtimeValid =
        available !== null &&
        running !== null &&
        (runtime?.activeRevision === null || appliedRevision !== null) &&
        (runtime?.lastApplyAt === null || timestamp(runtime?.lastApplyAt) !== null)
    const runtimeState =
        !runtimeValid || !available || !desiredRevision
            ? 'unavailable'
            : running && appliedRevision === desiredRevision
              ? 'synced'
              : 'pending'
    const configurationInput = isRecord(input.configuration) ? input.configuration : null
    const proxyHosts = hostCounts(configurationInput?.proxyHosts)
    const redirectHosts = hostCounts(configurationInput?.redirectHosts)
    const configuration = section(
        proxyHosts && redirectHosts ? { proxyHosts, redirectHosts } : null,
    )
    const certificates = section(certificateCounts(input.certificates))
    const certificateJobs = section(jobCounts(input.certificateJobs))
    const database = connected(input.databaseHealth)
    const valkey = connected(input.valkeyHealth)
    const unavailableSections: string[] = []
    if (application.state === 'unavailable') unavailableSections.push('application_version')
    if (controller.state === 'unavailable') unavailableSections.push('controller_version')
    if (caddy.state === 'unavailable') unavailableSections.push('caddy_version')
    if (!controllerConnected) unavailableSections.push('controller')
    if (database === 'unavailable') unavailableSections.push('database')
    if (valkey === 'unavailable') unavailableSections.push('valkey')
    if (runtimeState === 'unavailable') unavailableSections.push('runtime')
    if (configuration.state === 'unavailable') unavailableSections.push('configuration')
    if (certificates.state === 'unavailable') unavailableSections.push('certificates')
    if (certificateJobs.state === 'unavailable') unavailableSections.push('certificate_jobs')

    return {
        format: RUNTIME_SUPPORT_REPORT_FORMAT,
        formatVersion: RUNTIME_SUPPORT_REPORT_VERSION,
        capturedAt: capturedAt.toISOString(),
        completeness: unavailableSections.length === 0 ? 'complete' : 'partial',
        versions: {
            application,
            controller,
            caddy: { state: caddy.state, value: caddy.value, source: 'configured_binary' },
        },
        components: {
            controller: controllerConnected ? 'connected' : 'unavailable',
            database,
            valkey,
            caddy: {
                available: runtimeValid ? available : null,
                running: runtimeValid ? running : null,
            },
        },
        runtime: {
            state: runtimeState,
            desiredRevision,
            appliedRevision: runtimeValid ? appliedRevision : null,
            lastApplyAt: runtimeValid ? timestamp(runtime?.lastApplyAt) : null,
        },
        configuration,
        certificates,
        certificateJobs,
        unavailableSections,
    }
}

export function serializeRuntimeSupportReport(report: RuntimeSupportReport): string {
    const json = JSON.stringify(report, null, 2) + '\n'
    if (new TextEncoder().encode(json).byteLength > MAX_RUNTIME_SUPPORT_REPORT_BYTES)
        throw new Error('support_report_limit')
    return json
}
