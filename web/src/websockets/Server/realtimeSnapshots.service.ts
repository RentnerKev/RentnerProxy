import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '../../config/permissions.config'
import { proxyAccessLogsQuerySchema } from '../../features/Admin/ProxyAccessLogs/validation'
import { auditEventsQuerySchema } from '../../features/Admin/AuditLogs/validation'
import { getProxyAccessLogsService } from '../../server/Admin/ProxyAccessLogs/proxy-access-logs.service'
import { listAuditEventsService } from '../../server/Audit/audit-reader.service'
import { requirePermissionService } from '../../server/Auth/Access/authorization.service'
import { isAuthDomainError } from '../../server/Auth/Core/errors.server'
import { checkFoundationHealth } from '../../server/Foundation/health.service'
import { getPublicOrigin } from '../../server/env.server'
import { getApplicationRevision } from '../Helpers/publishFunctions'
import { getProxyHostsService } from '../../server/Admin/ProxyHostManagement/proxy-hosts.service'
import { getCertificatesService } from '../../server/Admin/CertificateManagement/certificates.service'
import { getProxyRuntimeStatusService } from '../../server/ProxyRuntime/proxy-runtime.service'
import { getRedirectHostsService } from '../../server/Admin/RedirectHostManagement/redirect-hosts.service'
import { getAccessPoliciesService } from '../../server/Admin/AccessPolicyManagement/access-policies.service'

function revisionOf(value: unknown): string {
    return new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function getLiveSnapshotResponse(request: Request): Promise<Response> {
    const headers = { 'Cache-Control': 'private, no-store' }
    const origin = request.headers.get('origin')
    if (!origin || origin !== getPublicOrigin()) {
        return new Response(null, { status: 403, headers })
    }
    try {
        const url = new URL(request.url)
        const encodedQuery = url.searchParams.get('query') ?? '{}'
        if (encodedQuery.length > 4096) return new Response(null, { status: 400, headers })
        const input: unknown = JSON.parse(encodedQuery)
        let data: unknown
        switch (url.searchParams.get('topic')) {
            case 'app-events': {
                const user = await requirePermissionService(PERMISSIONS.APP_ACCESS)
                data = {
                    revision: getApplicationRevision(),
                    userVersion: revisionOf(user),
                }
                break
            }
            case 'proxy-hosts':
                data = {
                    revision: revisionOf(
                        await Promise.all([getProxyHostsService(), getProxyRuntimeStatusService()]),
                    ),
                }
                break
            case 'certificates':
                data = { revision: revisionOf(await getCertificatesService()) }
                break
            case 'redirect-hosts':
                data = {
                    revision: revisionOf(
                        await Promise.all([
                            getRedirectHostsService(),
                            getProxyRuntimeStatusService(PERMISSIONS.REDIRECT_HOSTS_VIEW),
                        ]),
                    ),
                }
                break
            case 'access-policies':
                data = {
                    revision: revisionOf(
                        await Promise.all([
                            getAccessPoliciesService(),
                            getProxyRuntimeStatusService(PERMISSIONS.ACCESS_POLICIES_VIEW),
                        ]),
                    ),
                }
                break
            case 'access-logs': {
                const query = proxyAccessLogsQuerySchema.safeParse(input)
                if (!query.success || query.data.offset !== 0 || query.data.snapshot) {
                    return new Response(null, { status: 400, headers })
                }
                data = await getProxyAccessLogsService(query.data)
                break
            }
            case 'audit-logs': {
                const query = auditEventsQuerySchema.safeParse(input)
                if (!query.success || query.data.cursor) {
                    return new Response(null, { status: 400, headers })
                }
                data = await listAuditEventsService(query.data)
                break
            }
            case 'foundation':
                await requirePermissionService(PERMISSIONS.APP_ACCESS)
                data = await checkFoundationHealth()
                break
            default:
                return new Response(null, { status: 400, headers })
        }
        return Response.json(data, { headers })
    } catch (error) {
        const status =
            error instanceof SyntaxError
                ? 400
                : isAuthDomainError(error)
                  ? error.code === 'authentication_required'
                      ? 401
                      : error.code === 'permission_denied' || error.code === 'user_not_active'
                        ? 403
                        : 503
                  : 503
        return new Response(null, { status, headers })
    }
}
