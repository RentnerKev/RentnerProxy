import { getDnsProvidersService } from '@/server/Admin/DnsConnections/dns-providers.service.ts'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { DnsConnectionDomainError } from '@/server/Admin/DnsConnections/dns-connections.errors.ts'
import {
    getDnsConnectionsService,
    saveDnsConnectionService,
    testDnsConnectionService,
    verifyDnsConnectionService,
    deleteDnsConnectionService,
} from '@/server/Admin/DnsConnections/dns-connections.service.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import {
    saveDnsConnectionSchema,
    testDnsConnectionSchema,
    deleteDnsConnectionSchema,
} from './validation.ts'
import type { z } from 'zod'

// Never serialize Zod issues: these requests may contain credentials in rejected input.
export function validateDnsConnectionInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new Error('admin.dnsConnections.errors.invalid_input')
    return parsed.data
}
function noStore() {
    setResponseHeader('Cache-Control', 'private, no-store')
}
function failure(error: unknown) {
    if (!(error instanceof DnsConnectionDomainError))
        return localizedActionFailure(error, 'admin.dnsConnections.errors.controller_unavailable')
    setResponseStatus(
        error.code === 'connection_conflict' || error.code === 'connection_in_use'
            ? 409
            : error.code === 'connection_not_found'
              ? 404
              : error.code.endsWith('_unavailable')
                ? 503
                : error.code === 'provider_rate_limited'
                  ? 429
                  : 422,
    )
    return { success: false as const, message: `admin.dnsConnections.errors.${error.code}` }
}
export const getDnsConnectionsHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getDnsConnectionsService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.dnsConnections.errors.controller_unavailable')
    }
})
export const saveDnsConnectionHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDnsConnectionInput(saveDnsConnectionSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return {
                success: true as const,
                message: 'admin.dnsConnections.messages.saved',
                connection: await saveDnsConnectionService(data),
            }
        } catch (error) {
            return failure(error)
        }
    })
export const testDnsConnectionHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDnsConnectionInput(testDnsConnectionSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return {
                success: true as const,
                message: 'admin.dnsConnections.messages.tested',
                result: await testDnsConnectionService(data),
            }
        } catch (error) {
            return failure(error)
        }
    })
export const deleteDnsConnectionHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDnsConnectionInput(deleteDnsConnectionSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            await deleteDnsConnectionService(data)
            return { success: true as const, message: 'admin.dnsConnections.messages.deleted' }
        } catch (error) {
            return failure(error)
        }
    })

export const verifyDnsConnectionHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDnsConnectionInput(deleteDnsConnectionSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, connection: await verifyDnsConnectionService(data) }
        } catch (error) {
            return failure(error)
        }
    })

export const getDnsConnectionProvidersHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getDnsProvidersService('connections')
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.dnsConnections.providers.unavailable')
        }
    },
)
