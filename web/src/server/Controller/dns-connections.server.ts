import '@tanstack/react-start/server-only'
import type { z } from 'zod'
import type { DnsConnectionReference } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type { TestDnsConnectionInput } from '@/features/Admin/DnsConnections/Types/validation.types.ts'
import type {
    DnsConnectionControllerRequest,
    SaveControllerDnsConnectionInput,
    DnsConnectionsController,
} from './Types/dns-connections.types.ts'
import { DnsConnectionDomainError } from '@/server/Admin/DnsConnections/dns-connections.errors.ts'
import { controllerRequest } from './transport.server.ts'
import { dnsProviderCatalogSchema } from '@/lib/DnsConnections/validation.ts'
import {
    dnsConnectionControllerErrorSchema,
    dnsConnectionMetadataSchema,
    dnsConnectionsSchema,
    dnsConnectionTestResultSchema,
    validatedDnsConnectionReferenceSchema,
} from './dns-connections.validation.ts'

function decode<T>(payload: unknown, schema: z.ZodType<T>): T {
    const error = dnsConnectionControllerErrorSchema.safeParse(payload)
    if (error.success) throw new DnsConnectionDomainError(error.data.error)
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new DnsConnectionDomainError('controller_unavailable')
    return parsed.data
}

export function createDnsConnectionsController(
    request: DnsConnectionControllerRequest = controllerRequest,
): DnsConnectionsController {
    const options = {
        privileged: true,
        confidential: true,
        timeoutMs: 25_000,
        responseLimit: 1_048_576,
        acceptErrorResponse: true,
    } as const
    return {
        async providers() {
            return decode(
                await request('/internal/v1/dns/providers', { ...options, responseLimit: 16_384 }),
                dnsProviderCatalogSchema,
            ).providers
        },
        async list() {
            return decode(
                await request('/internal/v1/dns/connections', options),
                dnsConnectionsSchema,
            ).connections
        },
        async test(input: TestDnsConnectionInput) {
            const result = decode(
                await request('/internal/v1/dns/connections/test', {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
                dnsConnectionTestResultSchema,
            )
            if (
                input.zoneIds &&
                (input.zoneIds.length !== result.selectedZoneIds.length ||
                    input.zoneIds.some((id) => !result.selectedZoneIds.includes(id)))
            )
                throw new DnsConnectionDomainError('controller_unavailable')
            return result
        },
        async save(id: string, input: SaveControllerDnsConnectionInput) {
            const result = decode(
                await request(`/internal/v1/dns/connections/${encodeURIComponent(id)}`, {
                    ...options,
                    method: 'PUT',
                    body: JSON.stringify(input),
                }),
                dnsConnectionMetadataSchema,
            )
            if (
                result.id !== id ||
                result.revision !== input.expectedRevision + 1 ||
                result.name !== input.name ||
                (input.expectedRevision === 0 && result.createdByUserId !== input.actorUserId) ||
                result.zones.length !== input.zoneIds.length ||
                input.zoneIds.some((zoneId) => !result.zones.some((zone) => zone.id === zoneId))
            )
                throw new DnsConnectionDomainError('controller_unavailable')
            return result
        },
        async delete(id: string, expectedRevision: number) {
            const payload = await request(
                `/internal/v1/dns/connections/${encodeURIComponent(id)}`,
                { ...options, method: 'DELETE', body: JSON.stringify({ expectedRevision }) },
            )
            const error = dnsConnectionControllerErrorSchema.safeParse(payload)
            if (error.success) throw new DnsConnectionDomainError(error.data.error)
            if (
                !payload ||
                typeof payload !== 'object' ||
                Object.keys(payload).length !== 1 ||
                !('deleted' in payload) ||
                payload.deleted !== true
            )
                throw new DnsConnectionDomainError('controller_unavailable')
        },
        async validateReference(input: DnsConnectionReference) {
            const result = decode(
                await request('/internal/v1/dns/connections/references/validate', {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
                validatedDnsConnectionReferenceSchema,
            )
            if (
                result.reference.connectionId !== input.connectionId ||
                result.reference.zoneId !== input.zoneId ||
                result.zone.id !== input.zoneId ||
                result.reference.consumer.type !== input.consumer.type ||
                result.reference.consumer.id !== input.consumer.id
            )
                throw new DnsConnectionDomainError('controller_unavailable')
            return result
        },
    }
}

export const dnsConnectionsController = createDnsConnectionsController()
