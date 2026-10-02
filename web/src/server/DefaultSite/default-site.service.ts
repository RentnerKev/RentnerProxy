import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { defaultSiteSaveSchema } from '@/lib/DefaultSite/defaultSite.ts'
import type { DefaultSiteEditorData } from '@/shared/Types/default-site.types.ts'
import type { ProxyRuntimeMutationStatus } from '@/shared/Types/proxy-runtime.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { readProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-data.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { reconcileProxyConfigurationWithAudit } from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import { recordMutationFailureBestEffort } from '@/server/ProxyRuntime/audit-mutation.ts'
import { writeDefaultSiteSettings } from './default-site-settings.ts'
import { DefaultSiteError } from './default-site.errors.ts'

export async function getDefaultSiteService(): Promise<DefaultSiteEditorData> {
    const actor = await requirePermissionService(PERMISSIONS.DEFAULT_SITE_VIEW)
    return getAuthDatabase().transaction(
        async (transaction) => {
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.DEFAULT_SITE_VIEW,
            )
            const snapshot = await readProxyRuntimeSnapshot(transaction)
            return {
                baseRevision: snapshot.revision,
                settings: snapshot.defaultSite ?? { mode: 'not-found' },
            }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

export async function saveDefaultSiteService(input: unknown): Promise<ProxyRuntimeMutationStatus> {
    const actor = await requirePermissionService(PERMISSIONS.DEFAULT_SITE_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const parsed = defaultSiteSaveSchema.parse(input)
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.DEFAULT_SITE_UPDATE,
            )
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.PROXY_HOSTS_APPLY,
            )
            const latest = await readProxyRuntimeSnapshot(transaction)
            if (latest.revision !== parsed.baseRevision) {
                throw new DefaultSiteError('configuration_conflict')
            }
            await writeDefaultSiteSettings(transaction, parsed.settings)
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'save',
                resource: 'proxy-runtime-settings',
                targetId: null,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'save',
            resource: 'proxy-runtime-settings',
            targetId: null,
            error,
        })
        throw error
    }
    return reconcileProxyConfigurationWithAudit(actor.id)
}
