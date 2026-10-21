import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { hostKindSchema, hostTagMutationSchema } from './validation.ts'
import { HostTagDomainError } from '@/lib/HostTags/hostTags.ts'
import {
    getHostTagCatalogService,
    mutateHostTagService,
} from '@/server/Admin/HostTags/host-tags.service.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'

export const getHostTagCatalogHandler = createServerFn({ method: 'GET' })
    .validator(hostKindSchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return await getHostTagCatalogService(data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.hostTags.errors.loadFailed')
        }
    })

export const mutateHostTagHandler = createServerFn({ method: 'POST' })
    .validator(hostTagMutationSchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return { success: true as const, value: await mutateHostTagService(data) }
        } catch (error) {
            return error instanceof HostTagDomainError
                ? { success: false as const, message: error.message }
                : localizedActionFailure(error, 'admin.hostTags.errors.saveFailed')
        }
    })
