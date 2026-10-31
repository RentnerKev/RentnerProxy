import {
    createCsrfMiddleware,
    createMiddleware,
    createServerOnlyFn,
    createStart,
} from '@tanstack/react-start'
import { getRequestProtocol, setResponseHeaders } from '@tanstack/react-start/server'

import { getTrustProxyHeaders, validateProductionEnvironment } from '@/server/env.server.ts'
import { startRealtimeValkey } from '@/server/WebSockets/realtimeValkey.service.ts'
import { startWorkerLifecycle } from '@/server/Foundation/worker-lifecycle.server.ts'
import {
    applyAdminUiSecurityHeaders,
    createCspNonce,
    getAdminUiSecurityHeaders,
} from '@/server/security-headers.ts'

const validateProductionEnvironmentAtStartup = createServerOnlyFn(() => {
    if (process.env.NODE_ENV === 'production') validateProductionEnvironment()
})

if (typeof window === 'undefined') validateProductionEnvironmentAtStartup()

const startRealtimeEvents = createServerOnlyFn(startRealtimeValkey)
if (typeof window === 'undefined') startRealtimeEvents()

const startProxyRuntimeLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { reconcileProxyConfigurationService } =
            await import('@/server/ProxyRuntime/proxy-runtime.service.ts')
        return reconcileProxyConfigurationService
    }),
)

if (typeof window === 'undefined') void startProxyRuntimeLifecycle()

const startDockerDiscoveryLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { dockerDiscoveryWorker } =
            await import('@/server/Admin/DockerDiscovery/discovery-worker.ts')
        return dockerDiscoveryWorker
    }),
)
if (typeof window === 'undefined') void startDockerDiscoveryLifecycle()

const startCrowdSecRuntimeLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { reconcileCrowdSecConfiguration } =
            await import('@/server/Admin/CrowdSec/crowdsec.service.ts')
        return reconcileCrowdSecConfiguration
    }),
)

if (typeof window === 'undefined') void startCrowdSecRuntimeLifecycle()

const startCertificateEventsLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { startCertificateEventsSynchronization, stopCertificateEventsSynchronization } =
            await import('@/server/Admin/CertificateManagement/certificate-events.worker.ts')
        return {
            start: startCertificateEventsSynchronization,
            stop: stopCertificateEventsSynchronization,
        }
    }),
)

if (typeof window === 'undefined') void startCertificateEventsLifecycle()

const startCertificateJobsLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { startCertificateJobWorker, stopCertificateJobWorker } =
            await import('@/server/Admin/ProxyHostManagement/certificate-jobs.worker.server.ts')
        return { start: startCertificateJobWorker, stop: stopCertificateJobWorker }
    }),
)

if (typeof window === 'undefined') void startCertificateJobsLifecycle()

const startBackupOutcomesLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { backupOutcomesWorker } =
            await import('@/server/Admin/Backups/backup-outcomes.server.ts')
        return backupOutcomesWorker
    }),
)
if (typeof window === 'undefined') void startBackupOutcomesLifecycle()

const startNotificationLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { notificationWorker } =
            await import('@/server/Notifications/notification-worker.server.ts')
        return notificationWorker
    }),
)
if (typeof window === 'undefined') void startNotificationLifecycle()

const startHostMonitoringLifecycle = createServerOnlyFn(() =>
    startWorkerLifecycle(async () => {
        const { hostMonitoringWorker } =
            await import('@/server/HostMonitoring/host-monitoring.worker.server.ts')
        return hostMonitoringWorker
    }),
)
if (typeof window === 'undefined') void startHostMonitoringLifecycle()

const startNpmImportTempCleanup = createServerOnlyFn(async () => {
    const { pruneStaleNpmImports } = await import('@/server/Admin/NpmImport/npm-temp.ts')
    await pruneStaleNpmImports().catch(() => undefined)
    const timer = setInterval(
        () => {
            void pruneStaleNpmImports().catch(() => undefined)
        },
        60 * 60 * 1_000,
    )
    timer.unref()
    process.once('rentnerproxy:shutdown', () => clearInterval(timer))
})
if (typeof window === 'undefined') void startNpmImportTempCleanup()

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
    const nonce = createCspNonce()
    const securityHeaders = getAdminUiSecurityHeaders(
        getRequestProtocol({ xForwardedProto: getTrustProxyHeaders() }),
        nonce,
    )
    setResponseHeaders(new Headers(securityHeaders))

    const result = await next({ context: { cspNonce: nonce } })
    return {
        ...result,
        response: applyAdminUiSecurityHeaders(result.response, securityHeaders),
    }
})

const csrfMiddleware = createCsrfMiddleware({
    filter: (context) => context.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
    requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}))
