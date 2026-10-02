import '@tanstack/react-start/server-only'

import { asc } from 'drizzle-orm'

import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '@/shared/Types/proxy-access-logs.types.ts'
import { hostDomains } from '@/db/schema.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getProxyAccessLogs } from '@/server/Foundation/controller.server.ts'
import { proxyAccessLogsQuerySchema } from '@/features/Admin/ProxyAccessLogs/validation.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'

async function configuredProxyHostDomains(): Promise<readonly string[]> {
    const rows = await getAuthDatabase()
        .select({ domain: hostDomains.domain })
        .from(hostDomains)
        .orderBy(asc(hostDomains.domain))
    return rows.map(({ domain }) => domain)
}

export async function getProxyAccessLogsService(
    input: ProxyAccessLogsQuery,
): Promise<ProxyAccessLogsResult> {
    await requirePermissionService(PERMISSIONS.PROXY_ACCESS_LOGS_VIEW)
    const query = proxyAccessLogsQuerySchema.parse(input)
    const [result, configuredHosts] = await Promise.all([
        getProxyAccessLogs(query),
        configuredProxyHostDomains(),
    ])

    if (!result) {
        throw new AuthDomainError('service_unavailable', 'Proxy access logs are unavailable.')
    }

    const availableHosts = [
        ...new Set([...(result.availableHosts ?? []), ...configuredHosts]),
    ].toSorted((left, right) => left.localeCompare(right))
    const availableStatuses = [...new Set(result.availableStatuses ?? [])].toSorted(
        (left, right) => left - right,
    )
    return { ...result, availableHosts, availableStatuses }
}
