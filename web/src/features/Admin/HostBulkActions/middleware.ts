import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { bulkHostServices } from '@/server/Admin/HostBulkActions/bulk-hosts.storage.server.ts'
import { localizedActionFailure } from '@/server/Auth/transport.server.ts'
import { bulkHostApplySchema, bulkHostPreviewSchema } from './validation.ts'

export const previewBulkHostsHandler = createServerFn({ method: 'POST' })
    .validator(bulkHostPreviewSchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return { success: true as const, value: await bulkHostServices.preview(data) }
        } catch (error) {
            return localizedActionFailure(error, 'admin.bulkHosts.error')
        }
    })

export const applyBulkHostsHandler = createServerFn({ method: 'POST' })
    .validator(bulkHostApplySchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return { success: true as const, value: await bulkHostServices.apply(data) }
        } catch (error) {
            return localizedActionFailure(error, 'admin.bulkHosts.error')
        }
    })
