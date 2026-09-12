import '@tanstack/react-start/server-only'

import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '../../../shared/Types/proxy-access-logs.types'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import { getProxyAccessLogs } from '../../Foundation/controller.server'
import { proxyAccessLogsQuerySchema } from '../../../features/Admin/ProxyAccessLogs/validation'
import { PERMISSIONS } from '../../../config/permissions.config'

export async function getProxyAccessLogsService(
    input: ProxyAccessLogsQuery,
): Promise<ProxyAccessLogsResult> {
    await requirePermissionService(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW)
    const query = proxyAccessLogsQuerySchema.parse(input)
    const result = await getProxyAccessLogs(query)

    if (!result) {
        throw new AuthDomainError('service_unavailable', 'Proxy access logs are unavailable.')
    }

    return result
}
