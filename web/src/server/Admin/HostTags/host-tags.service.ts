import '@tanstack/react-start/server-only'
import { eq } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { proxyHosts, redirectHosts } from '@/db/schema.ts'
import { hostKindSchema, hostTagMutationSchema } from '@/features/Admin/HostTags/validation.ts'
import { HostTagDomainError, mutateHostTags, tagsForHost } from '@/lib/HostTags/hostTags.ts'
import type { HostKind } from '@/lib/HostTags/Types/host-tags.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { readHostTags, writeHostTags } from './host-tags.storage.server.ts'
import type { HostTagDependencies } from './Types/host-tags-service.types.ts'

const permissionsFor = (kind: HostKind) =>
    kind === 'proxy'
        ? { view: PERMISSIONS.PROXY_HOSTS_VIEW, update: PERMISSIONS.PROXY_HOSTS_UPDATE }
        : { view: PERMISSIONS.REDIRECT_HOSTS_VIEW, update: PERMISSIONS.REDIRECT_HOSTS_UPDATE }

export function createHostTagServices(dependencies: HostTagDependencies) {
    async function catalog(kindInput: HostKind) {
        const kind = hostKindSchema.parse(kindInput)
        const permission = permissionsFor(kind).view
        const actor = await dependencies.authorize(permission)
        return dependencies.transaction(async (transaction) => {
            await dependencies.reauthorize(transaction, actor.id, permission)
            const state = await dependencies.read(transaction, kind)
            return {
                revision: state.revision,
                tags: state.tags.toSorted((a, b) => a.name.localeCompare(b.name)),
            }
        }, true)
    }
    async function mutate(input: unknown) {
        const parsed = hostTagMutationSchema.safeParse(input)
        if (!parsed.success) throw new HostTagDomainError('invalid')
        const data = parsed.data
        const permissions = permissionsFor(data.kind)
        const actor = await dependencies.authorize(permissions.view)
        if (!actor.permissions.includes(permissions.update))
            throw new AuthDomainError('permission_denied', 'Permission is required.')
        return dependencies.transaction(async (transaction) => {
            await dependencies.lock(transaction)
            await dependencies.reauthorize(transaction, actor.id, permissions.view)
            await dependencies.reauthorize(transaction, actor.id, permissions.update)
            if (
                data.action === 'assign' &&
                !(await dependencies.hostExists(transaction, data.kind, data.hostId))
            ) {
                throw new HostTagDomainError('missing')
            }
            const state = await dependencies.read(transaction, data.kind)
            const id = dependencies.newId()
            const next = mutateHostTags(state, data, id)
            if (next !== state) {
                await dependencies.write(transaction, data.kind, next)
                await dependencies.audit(transaction, {
                    actorUserId: actor.id,
                    actorKind: 'user',
                    action:
                        data.action === 'assign' || data.action === 'rename'
                            ? 'update'
                            : data.action,
                    resource: data.kind === 'proxy' ? 'proxy-host-settings' : 'redirect-host',
                    targetId:
                        data.action === 'assign'
                            ? data.hostId
                            : data.action === 'create'
                              ? id
                              : data.tagId,
                    result: 'success',
                    metadata: { changedFields: ['tags'], revision: next.revision },
                })
            }
            return {
                revision: next.revision,
                tags: next.tags.toSorted((a, b) => a.name.localeCompare(b.name)),
            }
        })
    }
    return { catalog, mutate }
}

const services = createHostTagServices({
    authorize: requirePermissionService,
    reauthorize: requirePermissionInTransaction,
    transaction: (run, readOnly) =>
        getAuthDatabase().transaction(run, readOnly ? { accessMode: 'read only' } : undefined),
    lock: lockProxyRuntimeSettings,
    read: readHostTags,
    write: writeHostTags,
    hostExists: async (transaction, kind, id) => {
        const table = kind === 'proxy' ? proxyHosts : redirectHosts
        const [row] = await transaction
            .select({ id: table.id })
            .from(table)
            .where(eq(table.id, id))
            .limit(1)
        return Boolean(row)
    },
    audit: appendAuditEventInTransactionService,
    newId: () => crypto.randomUUID(),
})

export const getHostTagCatalogService = services.catalog
export const mutateHostTagService = services.mutate

export async function attachHostTagsService<T extends { readonly id: string }>(
    kind: HostKind,
    hosts: readonly T[],
) {
    const permission =
        kind === 'proxy' ? PERMISSIONS.PROXY_HOSTS_VIEW : PERMISSIONS.REDIRECT_HOSTS_VIEW
    await requirePermissionService(permission)
    const state = await getAuthDatabase().transaction(
        (transaction) => readHostTags(transaction, kind),
        { accessMode: 'read only' },
    )
    return hosts.map((host) => ({ ...host, tags: tagsForHost(state, host.id) }))
}
