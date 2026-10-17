import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DDNS_MUTATION_RATE_LIMIT, DDNS_PROVIDER_RATE_LIMIT } from '@/config/ddns.config.ts'
import {
    ddnsActionSchema,
    enableDdnsSchema,
    previewDdnsSchema,
    saveDdnsSchema,
} from '@/features/Admin/Ddns/validation.ts'
import type {
    DdnsActionInput,
    EnableDdnsInput,
    PreviewDdnsInput,
    SaveDdnsInput,
} from '@/features/Admin/Ddns/Types/validation.types.ts'
import type { DdnsPreview } from '@/lib/Ddns/Types/ddns.types.ts'
import type { AuditAction } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import {
    activeDdnsTarget,
    ddnsDraft,
    ddnsFingerprint,
    readyDdnsPreview,
} from '@/lib/Ddns/targets.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { ddnsController } from '@/server/Controller/ddns.server.ts'
import { dnsConnectionsController } from '@/server/Controller/dns-connections.server.ts'
import { ddnsReceiptService } from './ddns-preview.service.ts'
import { DdnsDomainError } from './ddns.errors.ts'
import type { DdnsDependencies } from './Types/ddns.types.ts'

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new DdnsDomainError('invalid_input')
    return parsed.data
}
export function createDdnsService(dependencies: DdnsDependencies) {
    async function current(revision: number) {
        const snapshot = await dependencies.controller.status()
        if ((snapshot.configuration?.revision ?? 0) !== revision)
            throw new DdnsDomainError('conflict')
        return snapshot
    }
    async function mutation<T>(actorUserId: string, action: AuditAction, run: () => Promise<T>) {
        let result: 'success' | 'failure' = 'failure'
        try {
            const value = await run()
            result = 'success'
            return value
        } catch (error) {
            if (error instanceof DdnsDomainError) throw error
            throw new DdnsDomainError('controller_unavailable')
        } finally {
            try {
                await dependencies.audit({
                    actorUserId,
                    actorKind: 'user',
                    action,
                    resource: 'security-settings',
                    targetId: null,
                    result,
                    metadata: { changedFields: ['ddns'] },
                })
            } catch {
                console.error('[ddns] Audit write unavailable')
            }
        }
    }
    return {
        async getDdnsStatusService() {
            await dependencies.authorize(PERMISSIONS.DDNS_VIEW)
            return dependencies.controller.status()
        },
        async getDdnsConnectionsService() {
            await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
            await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_VIEW)
            return dependencies.connections()
        },
        async previewDdnsService(input: PreviewDdnsInput): Promise<DdnsPreview> {
            const actor = await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
            const { expectedRevision, draft, intent } = validate(previewDdnsSchema, input)
            await dependencies.limit(actor.id, true)
            const snapshot = await current(expectedRevision)
            if (
                intent === 'enable' &&
                (!snapshot.configuration ||
                    snapshot.configuration.settings.enabled ||
                    ddnsFingerprint(snapshot.configuration.settings) !== ddnsFingerprint(draft) ||
                    !draft.targets.some((target) => activeDdnsTarget(draft, target)))
            )
                throw new DdnsDomainError('invalid_input')
            const batch = draft.targets.length
                ? await dependencies.controller.preview({
                      actorUserId: actor.id,
                      ipv4: draft.ipv4,
                      ipv6: draft.ipv6,
                      targets: draft.targets,
                  })
                : { preview: true, ipv4: null, ipv6: null, targets: [] }
            if (!readyDdnsPreview(draft, batch)) return { batch, receipt: null, expiresAt: null }
            await current(expectedRevision)
            return {
                batch,
                ...(await dependencies.receipt.issue(actor.id, intent, expectedRevision, draft)),
            }
        },
        async saveDdnsService(input: SaveDdnsInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
            const data = validate(saveDdnsSchema, input)
            await dependencies.limit(actor.id, false)
            return mutation(actor.id, 'update', async () => {
                const snapshot = await current(data.expectedRevision)
                if (snapshot.configuration?.settings.enabled && !data.confirmedPause)
                    throw new DdnsDomainError('pause_confirmation_required')
                await dependencies.receipt.verify(
                    actor.id,
                    'save',
                    data.expectedRevision,
                    data.draft,
                    data.receipt,
                )
                return dependencies.controller.save({
                    actorUserId: actor.id,
                    expectedRevision: data.expectedRevision,
                    configuration: { ...data.draft, enabled: false },
                })
            })
        },
        async enableDdnsService(input: EnableDdnsInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
            const data = validate(enableDdnsSchema, input)
            await dependencies.limit(actor.id, false)
            return mutation(actor.id, 'enable', async () => {
                const snapshot = await current(data.expectedRevision)
                if (!snapshot.configuration || snapshot.configuration.settings.enabled)
                    throw new DdnsDomainError('conflict')
                const draft = ddnsDraft(snapshot.configuration.settings)
                if (!draft.targets.some((target) => activeDdnsTarget(draft, target)))
                    throw new DdnsDomainError('invalid_input')
                await dependencies.receipt.verify(
                    actor.id,
                    'enable',
                    data.expectedRevision,
                    draft,
                    data.receipt,
                )
                return dependencies.controller.enable({
                    actorUserId: actor.id,
                    expectedRevision: data.expectedRevision,
                })
            })
        },
        async disableDdnsService(input: DdnsActionInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
            const data = validate(ddnsActionSchema, input)
            await dependencies.limit(actor.id, false)
            return mutation(actor.id, 'disable', () =>
                dependencies.controller.disable({ ...data, actorUserId: actor.id }),
            )
        },
        async syncDdnsService(input: DdnsActionInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DDNS_MANAGE)
            const data = validate(ddnsActionSchema, input)
            await dependencies.limit(actor.id, true)
            return mutation(actor.id, 'request', () =>
                dependencies.controller.sync({ ...data, actorUserId: actor.id }),
            )
        },
    }
}
export const {
    getDdnsStatusService,
    getDdnsConnectionsService,
    previewDdnsService,
    saveDdnsService,
    enableDdnsService,
    disableDdnsService,
    syncDdnsService,
} = createDdnsService({
    authorize: requirePermissionService,
    controller: ddnsController,
    connections: () => dnsConnectionsController.list(),
    receipt: ddnsReceiptService,
    audit: recordAuditEventBestEffortService,
    limit: async (actor, provider) => {
        await consumeRateLimit({
            ...(provider ? DDNS_PROVIDER_RATE_LIMIT : DDNS_MUTATION_RATE_LIMIT),
            identifier: actor,
        })
    },
})
