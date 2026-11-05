import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { proxyAccessLogsQuerySchema } from '@/features/Admin/ProxyAccessLogs/validation.ts'
import { auditEventsQuerySchema } from '@/features/Admin/AuditLogs/validation.ts'
import { getProxyAccessLogsService } from '@/server/Admin/ProxyAccessLogs/proxy-access-logs.service.ts'
import { listAuditEventsService } from '@/server/Audit/audit-reader.service.ts'
import {
    requirePermissionService,
    requireSessionService,
    requireSessionPermission,
} from '@/server/Auth/Access/authorization.service.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { checkFoundationHealthService } from '@/server/Foundation/health.service.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { getApplicationRevision } from './applicationChanges.ts'
import principalVersion from '@/lib/Auth/principalVersion.ts'
import identityScopeVersion from '@/lib/Auth/identityScopeVersion.ts'
import { getCertificatesService } from '@/server/Admin/CertificateManagement/certificates.service.ts'
import { getDnsConnectionsService } from '@/server/Admin/DnsConnections/dns-connections.service.ts'
import { getDdnsStatusService } from '@/server/Admin/Ddns/ddns.service.ts'
import { getDiscoveryOverviewService } from '@/server/Admin/DockerDiscovery/discovery-management.service.ts'
import { getProxyLiveRevisionService } from './proxy-live-revision.server.ts'
import { getForwardAuthSummaryService } from '@/server/ForwardAuth/forward-auth-summary.service.ts'
import { crowdSecDashboardQuerySchema } from '@/features/Admin/CrowdSec/validation.ts'
import {
    getCrowdSecConfigurationService,
    getCrowdSecDashboardService,
} from '@/server/Admin/CrowdSec/crowdsec.service.ts'
import { getBackupsStatusService } from '@/server/Admin/Backups/backups.service.ts'
import { getLocalBackupDemoStatus } from '@/server/Admin/Backups/backups-demo.server.ts'
import { backupsController } from '@/server/Controller/backups.server.ts'
import {
    getActiveRestoreMaintenance,
    isRestoreMaintenanceFenced,
    authorizeMaintenanceSnapshot,
} from '@/server/Backups/restore-maintenance.server.ts'

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
        const topic = url.searchParams.get('topic')
        const maintenance = await getActiveRestoreMaintenance()
        if (isRestoreMaintenanceFenced()) {
            if (!(await authorizeMaintenanceSnapshot(request)))
                return new Response(null, { status: 503, headers })
            return Response.json(
                topic === 'backup-restore' ? { maintenance } : { maintenanceSuspended: true },
                { headers },
            )
        }
        let data: unknown
        switch (topic) {
            case 'backups':
                data = await getBackupsStatusService()
                break
            case 'backup-restore': {
                await requirePermissionService(PERMISSIONS.APP_ACCESS)
                let latest = maintenance
                if (!latest) {
                    const demo = await getLocalBackupDemoStatus()
                    if (demo) latest = demo.maintenance ?? null
                    else latest = await backupsController.maintenance().catch(() => null)
                }
                data = { maintenance: latest?.operation === 'restore' ? latest : null }
                break
            }
            case 'app-events': {
                const session = await requireSessionService()
                await requireSessionPermission(session, PERMISSIONS.APP_ACCESS)
                const user = session.user
                data = {
                    revision: getApplicationRevision(),
                    userVersion: revisionOf(user),
                    identityVersion: revisionOf(principalVersion(user)),
                    sessionVersion: await identityScopeVersion(
                        JSON.stringify([principalVersion(user), session.id]),
                    ),
                }
                break
            }
            case 'proxy-hosts':
                data = await getProxyLiveRevisionService('proxy-hosts')
                break
            case 'certificates':
                data = { revision: revisionOf(await getCertificatesService()) }
                break
            case 'dns-connections':
                data = { revision: revisionOf(await getDnsConnectionsService()) }
                break
            case 'ddns':
                data = { revision: revisionOf(await getDdnsStatusService()) }
                break
            case 'docker-discovery':
                data = { revision: revisionOf(await getDiscoveryOverviewService()) }
                break
            case 'redirect-hosts':
                data = await getProxyLiveRevisionService('redirect-hosts')
                break
            case 'access-policies':
                data = await getProxyLiveRevisionService('access-policies')
                break
            case 'crowdsec-configuration':
                data = await getCrowdSecConfigurationService()
                break
            case 'forward-auth':
                data = await getForwardAuthSummaryService()
                break
            case 'crowdsec-dashboard': {
                const query = crowdSecDashboardQuerySchema.safeParse(input)
                if (!query.success) return new Response(null, { status: 400, headers })
                data = await getCrowdSecDashboardService(query.data)
                break
            }
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
                data = await checkFoundationHealthService()
                break
            default:
                return new Response(null, { status: 400, headers })
        }
        return Response.json(data, { headers })
    } catch (error) {
        let status = 503
        if (error instanceof SyntaxError) status = 400
        else if (isAuthDomainError(error)) {
            if (error.code === 'authentication_required') status = 401
            else if (error.code === 'permission_denied' || error.code === 'user_not_active')
                status = 403
        }
        return new Response(null, { status, headers })
    }
}
