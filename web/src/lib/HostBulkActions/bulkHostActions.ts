import { PERMISSIONS } from '@/config/permissions.config.ts'
import { hostTagIdsSchema } from '@/lib/HostTags/hostTags.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { HostKind, HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import type { BulkHostAction } from './Types/bulk-hosts.types.ts'

export function bulkHostPermissions(
    kind: HostKind,
    action: BulkHostAction,
): readonly PermissionKey[] {
    const proxy = kind === 'proxy'
    const view = proxy ? PERMISSIONS.PROXY_HOSTS_VIEW : PERMISSIONS.REDIRECT_HOSTS_VIEW
    const manage =
        action.type === 'enable'
            ? proxy
                ? PERMISSIONS.PROXY_HOSTS_ENABLE
                : PERMISSIONS.REDIRECT_HOSTS_ENABLE
            : action.type === 'disable'
              ? proxy
                  ? PERMISSIONS.PROXY_HOSTS_DISABLE
                  : PERMISSIONS.REDIRECT_HOSTS_DISABLE
              : proxy
                ? PERMISSIONS.PROXY_HOSTS_UPDATE
                : PERMISSIONS.REDIRECT_HOSTS_UPDATE
    return [
        view,
        manage,
        ...(action.type === 'accessPolicy' ? [PERMISSIONS.ACCESS_POLICIES_ASSIGN] : []),
    ]
}

export function availableBulkHostActions(
    kind: HostKind,
    permissions: readonly PermissionKey[],
): BulkHostAction['type'][] {
    const actions: BulkHostAction[] = [
        { type: 'enable' },
        { type: 'disable' },
        { type: 'addTags', tagIds: [] },
        { type: 'removeTags', tagIds: [] },
        { type: 'certificate', certificateId: null },
        ...(kind === 'proxy' ? [{ type: 'accessPolicy' as const, accessPolicyId: null }] : []),
    ]
    return actions
        .filter((action) =>
            bulkHostPermissions(kind, action).every((permission) =>
                permissions.includes(permission),
            ),
        )
        .map((action) => action.type)
}

export function bulkHostTagIds(
    state: HostTagState,
    hostId: string,
    action: BulkHostAction,
): string[] {
    const current = state.assignments[hostId] ?? []
    if (action.type !== 'addTags' && action.type !== 'removeTags') return [...current].toSorted()
    if (action.tagIds.some((id) => !state.tags.some((tag) => tag.id === id)))
        throw new Error('invalid tags')
    return hostTagIdsSchema
        .parse(
            action.type === 'addTags'
                ? [...new Set([...current, ...action.tagIds])]
                : current.filter((id) => !action.tagIds.includes(id)),
        )
        .toSorted()
}
