// oxlint-disable-next-line import/no-unassigned-import -- Audit helpers stay on the server boundary.
import '@tanstack/react-start/server-only'

import type { AuditAction, AuditResource } from '../../shared/Types/audit-events.types'
import { recordAuditEventBestEffort } from '../Audit/audit.service'

function isPermissionDenial(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false
    const code = (error as { readonly code?: unknown }).code
    return (
        code === 'permission_denied' ||
        code === 'authentication_required' ||
        code === 'reauthentication_required' ||
        code === 'owner_required'
    )
}

export function recordMutationFailureBestEffort(input: {
    readonly actorId: string
    readonly action: AuditAction
    readonly resource: AuditResource
    readonly targetId: string | null
    readonly error: unknown
}): Promise<void> {
    return recordAuditEventBestEffort({
        actorUserId: input.actorId,
        actorKind: 'user',
        action: input.action,
        resource: input.resource,
        targetId: input.targetId,
        result: isPermissionDenial(input.error) ? 'denied' : 'failure',
    })
}
