import '@tanstack/react-start/server-only'

import { asc } from 'drizzle-orm'

import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '../../../shared/Types/proxy-access-logs.types'
import { hostDomains } from '../../../db/schema'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { AuthDomainError } from '../../Auth/Core/errors.server'
import { getAuthDatabase } from '../../Auth/Core/database.server'
import { getProxyAccessLogs } from '../../Foundation/controller.server'
import { proxyAccessLogsQuerySchema } from '../../../features/Admin/ProxyAccessLogs/validation'
import { PERMISSIONS } from '../../../config/permissions.config'
import { clientCountryCode } from './client-country'

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
    const entries = []
    for (const entry of result.entries) {
        entries.push({
            ...entry,
            countryCode: clientCountryCode(entry.clientIp),
        })
    }
    return { ...result, availableHosts, availableStatuses, entries }
}
