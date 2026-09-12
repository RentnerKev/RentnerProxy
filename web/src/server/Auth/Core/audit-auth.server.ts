import '@tanstack/react-start/server-only'

import { recordAuditEventBestEffort } from '../../Audit/audit.service'

type FailureEvent = Omit<Parameters<typeof recordAuditEventBestEffort>[0], 'result'>

// Success is recorded by the mutation's transaction. Rejections are recorded only
// after that transaction has completed or rolled back, without retaining inputs.
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
            await recordAuditEventBestEffort({ ...event, result: 'failure' })
        }
        return result
    } catch (error) {
        const code =
            typeof error === 'object' && error !== null && 'code' in error ? error.code : null
        // Keep throttled requests cheap: the rate limiter has already rejected them
        // before database work, including audit writes, is allowed.
        if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT_UNAVAILABLE') throw error
        const denied =
            code === 'permission_denied' ||
            code === 'authentication_required' ||
            code === 'reauthentication_required' ||
            code === 'owner_required'
        await recordAuditEventBestEffort({ ...event, result: denied ? 'denied' : 'failure' })
        throw error
    }
}
