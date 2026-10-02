import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import { getProxyAccessLogsService } from '@/server/Admin/ProxyAccessLogs/proxy-access-logs.service.ts'
import { throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import { proxyAccessLogsQuerySchema } from './validation.ts'

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

export const getProxyAccessLogsHandler = createServerFn({ method: 'GET' })
    .validator(proxyAccessLogsQuerySchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            return await getProxyAccessLogsService(data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.proxyAccessLogs.errors.loadFailed')
        }
    })
