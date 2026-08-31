import '@tanstack/react-start/server-only'

import { asc, eq } from 'drizzle-orm'

import { PERMISSIONS } from '../../config/permissions.config'
import { proxyHostDomains, proxyHosts } from '../../db/schema'
import type { ProxyRuntimeSyncStatus } from '../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../Auth/Access/authorization.service'
import { getAuthDatabase } from '../Auth/Core/database.server'
import {
    applyProxyRuntimeConfiguration,
    getProxyRuntimeStatus,
} from '../Foundation/controller.server'
import { createProxyReconciler } from './proxy-reconcile'
import { compareProxyRuntimeStatus, createProxyRuntimeSnapshot } from './proxy-runtime-snapshot'
import type { ProxyRuntimeSnapshot } from './Types/proxy-runtime.types'

export async function getProxyRuntimeSnapshotService(): Promise<ProxyRuntimeSnapshot> {
    // One statement gives a consistent committed snapshot of hosts and their domains.
    // This is internal business logic: callers enforce view/apply or mutation permission.
    const rows = await getAuthDatabase()
        .select({
            id: proxyHosts.id,
            domain: proxyHostDomains.domain,
            forwardScheme: proxyHosts.forwardScheme,
            forwardHost: proxyHosts.forwardHost,
            forwardPort: proxyHosts.forwardPort,
        })
        .from(proxyHosts)
        .leftJoin(proxyHostDomains, eq(proxyHostDomains.proxyHostId, proxyHosts.id))
        .where(eq(proxyHosts.enabled, true))
        .orderBy(asc(proxyHosts.id), asc(proxyHostDomains.domain))
    const hosts = new Map<
        string,
        {
            id: string
            domains: string[]
            forwardScheme: 'http' | 'https'
            forwardHost: string
            forwardPort: number
            enabled: boolean
        }
    >()

    for (const row of rows) {
        let host = hosts.get(row.id)

        if (!host) {
            host = {
                id: row.id,
                domains: [],
                forwardScheme: row.forwardScheme,
                forwardHost: row.forwardHost,
                forwardPort: row.forwardPort,
                enabled: true,
            }
            hosts.set(row.id, host)
        }

        if (row.domain !== null) host.domains.push(row.domain)
    }

    return createProxyRuntimeSnapshot([...hosts.values()])
}

export const reconcileProxyConfigurationService = createProxyReconciler({
    loadSnapshot: getProxyRuntimeSnapshotService,
    applySnapshot: applyProxyRuntimeConfiguration,
})

export async function getProxyRuntimeStatusService(): Promise<ProxyRuntimeSyncStatus> {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_VIEW)
    const [snapshot, runtime] = await Promise.all([
        getProxyRuntimeSnapshotService(),
        getProxyRuntimeStatus(),
    ])

    return compareProxyRuntimeStatus(snapshot.revision, runtime)
}

export async function applyProxyConfigurationService() {
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    return reconcileProxyConfigurationService()
}
