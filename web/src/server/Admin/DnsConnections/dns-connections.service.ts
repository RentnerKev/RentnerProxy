import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DNS_CONNECTION_PROVIDER_RATE_LIMIT } from '@/config/dns-connections.config.ts'
import {
    saveDnsConnectionSchema,
    testDnsConnectionSchema,
    deleteDnsConnectionSchema,
    dnsConnectionReferenceSchema,
} from '@/features/Admin/DnsConnections/validation.ts'
import type {
    SaveDnsConnectionInput,
    TestDnsConnectionInput,
    DeleteDnsConnectionInput,
} from '@/features/Admin/DnsConnections/Types/validation.types.ts'
import type { DnsConnectionReference } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type { AuditAction } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { dnsConnectionsController } from '@/server/Controller/dns-connections.server.ts'
import { DnsConnectionDomainError } from './dns-connections.errors.ts'
import type { DnsConnectionsDependencies } from './Types/dns-connections.types.ts'

export function createDnsConnectionsService(dependencies: DnsConnectionsDependencies) {
    async function audit(
        actorId: string,
        action: AuditAction,
        targetId: string | null,
        result: 'success' | 'failure',
    ) {
        try {
            await dependencies.audit({
                actorUserId: actorId,
                actorKind: 'user',
                action,
                resource: 'security-settings',
                metadata: { changedFields: ['dnsConnections'] },
                targetId,
                result,
            })
        } catch {
            // The core operation may already be durable. Never invite a mutation retry for audit failure.
            console.error('[dns-connections] Audit write unavailable')
        }
    }
    async function mutation<T>(
        actorId: string,
        action: AuditAction,
        targetId: string | null,
        run: () => Promise<T>,
    ) {
        let value: T
        try {
            value = await run()
        } catch (error) {
            await audit(actorId, action, targetId, 'failure')
            // Controller clients expose allowlisted domain errors only. Unexpected exceptions cannot carry secrets outward.
            if (error instanceof DnsConnectionDomainError) throw error
            throw new DnsConnectionDomainError('controller_unavailable')
        }
        await audit(actorId, action, targetId, 'success')
        return value
    }
    return {
        async getDnsConnectionsService() {
            await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_VIEW)
            return dependencies.controller.list()
        },
        async saveDnsConnectionService(input: SaveDnsConnectionInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_MANAGE)
            const parsed = saveDnsConnectionSchema.safeParse(input)
            if (!parsed.success) throw new DnsConnectionDomainError('invalid_input')
            await dependencies.limitProvider(actor.id)
            const { connectionId, ...body } = parsed.data
            const id = connectionId ?? dependencies.createId()
            const connection = await mutation(
                actor.id,
                connectionId ? 'update' : 'create',
                id,
                () => dependencies.controller.save(id, { ...body, actorUserId: actor.id }),
            )
            if (connectionId && body.apiToken) await audit(actor.id, 'rotate', id, 'success')
            return connection
        },
        async testDnsConnectionService(input: TestDnsConnectionInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_MANAGE)
            const parsed = testDnsConnectionSchema.safeParse(input)
            if (!parsed.success) throw new DnsConnectionDomainError('invalid_input')
            await dependencies.limitProvider(actor.id)
            return mutation(actor.id, 'request', parsed.data.connectionId ?? null, () =>
                dependencies.controller.test(parsed.data),
            )
        },
        async deleteDnsConnectionService(input: DeleteDnsConnectionInput) {
            const actor = await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_MANAGE)
            const parsed = deleteDnsConnectionSchema.safeParse(input)
            if (!parsed.success) throw new DnsConnectionDomainError('invalid_input')
            await mutation(actor.id, 'delete', parsed.data.connectionId, () =>
                dependencies.controller.delete(
                    parsed.data.connectionId,
                    parsed.data.expectedRevision,
                ),
            )
        },
        async validateDnsConnectionReferenceService(input: DnsConnectionReference) {
            await dependencies.authorize(PERMISSIONS.DNS_CONNECTIONS_MANAGE)
            const parsed = dnsConnectionReferenceSchema.safeParse(input)
            if (!parsed.success) throw new DnsConnectionDomainError('invalid_input')
            return dependencies.controller.validateReference(parsed.data)
        },
    }
}

export const {
    getDnsConnectionsService,
    saveDnsConnectionService,
    testDnsConnectionService,
    deleteDnsConnectionService,
    validateDnsConnectionReferenceService,
} = createDnsConnectionsService({
    authorize: requirePermissionService,
    controller: dnsConnectionsController,
    audit: recordAuditEventBestEffortService,
    limitProvider: async (actorId) => {
        await consumeRateLimit({ ...DNS_CONNECTION_PROVIDER_RATE_LIMIT, identifier: actorId })
    },
    createId: () => Bun.randomUUIDv7(),
})
