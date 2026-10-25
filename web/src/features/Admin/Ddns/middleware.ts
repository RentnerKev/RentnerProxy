import { getDdnsProviderContextService } from '@/server/Admin/DnsConnections/dns-providers.service.ts'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import type { z } from 'zod'
import {
    getDdnsStatusService,
    getDdnsConnectionsService,
    previewDdnsService,
    saveDdnsService,
    enableDdnsService,
    disableDdnsService,
    syncDdnsService,
    applyDdnsService,
} from '@/server/Admin/Ddns/ddns.service.ts'
import { DdnsDomainError } from '@/server/Admin/Ddns/ddns.errors.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import {
    ddnsActionSchema,
    enableDdnsSchema,
    previewDdnsSchema,
    saveDdnsSchema,
    applyDdnsSchema,
} from './validation.ts'

function validateDdnsInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new Error('admin.ddns.errors.invalid_input')
    return parsed.data
}
function noStore() {
    setResponseHeader('Cache-Control', 'private, no-store')
}
function failure(error: unknown) {
    if (!(error instanceof DdnsDomainError))
        return localizedActionFailure(error, 'admin.ddns.errors.controller_unavailable')
    setResponseStatus(
        error.code === 'conflict' || error.code === 'busy'
            ? 409
            : error.code === 'retry_deferred'
              ? 429
              : error.code.endsWith('_unavailable')
                ? 503
                : 422,
    )
    if (error.retryAfterSeconds) setResponseHeader('Retry-After', String(error.retryAfterSeconds))
    return {
        success: false as const,
        message: error.recordError
            ? `admin.ddns.recordErrors.${error.recordError}`
            : `admin.ddns.errors.${error.code}`,
    }
}
export const getDdnsStatusHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getDdnsStatusService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.ddns.errors.controller_unavailable')
    }
})
export const applyDdnsHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDdnsInput(applyDdnsSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await applyDdnsService(data) }
        } catch (error) {
            return failure(error)
        }
    })
export const getDdnsConnectionsHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getDdnsConnectionsService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.ddns.errors.connection_unavailable')
    }
})
export const previewDdnsHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDdnsInput(previewDdnsSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await previewDdnsService(data) }
        } catch (error) {
            return failure(error)
        }
    })
export const saveDdnsHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDdnsInput(saveDdnsSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await saveDdnsService(data) }
        } catch (error) {
            return failure(error)
        }
    })
export const enableDdnsHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDdnsInput(enableDdnsSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await enableDdnsService(data) }
        } catch (error) {
            return failure(error)
        }
    })
export const disableDdnsHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDdnsInput(ddnsActionSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await disableDdnsService(data) }
        } catch (error) {
            return failure(error)
        }
    })
export const syncDdnsHandler = createServerFn({ method: 'POST' })
    .validator((input: unknown) => validateDdnsInput(ddnsActionSchema, input))
    .handler(async ({ data }) => {
        noStore()
        try {
            return { success: true as const, value: await syncDdnsService(data) }
        } catch (error) {
            return failure(error)
        }
    })

export const getDdnsProvidersHandler = createServerFn({ method: 'GET' }).handler(async () => {
    noStore()
    try {
        return await getDdnsProviderContextService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.dnsConnections.providers.unavailable')
    }
})
