import '@tanstack/react-start/server-only'

import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'

type FailureEvent = Omit<Parameters<typeof recordAuditEventBestEffortService>[0], 'result'>

export async function auditAuthOperation<T>(
    event: FailureEvent,
    operation: () => Promise<T>,
): Promise<T> {
    try {
        const result = await operation()
        if (
            result === false ||
            (typeof result === 'object' &&
                result !== null &&
                'success' in result &&
                result.success === false)
        ) {
            await recordAuditEventBestEffortService({ ...event, result: 'failure' })
        }
        return result
    } catch (error) {
        const code =
            typeof error === 'object' && error !== null && 'code' in error ? error.code : null

        if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT_UNAVAILABLE') throw error
        const denied =
            code === 'permission_denied' ||
            code === 'authentication_required' ||
            code === 'reauthentication_required' ||
            code === 'owner_required'
        await recordAuditEventBestEffortService({ ...event, result: denied ? 'denied' : 'failure' })
        throw error
    }
}
