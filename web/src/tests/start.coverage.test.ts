import { expect, mock, spyOn, test } from 'bun:test'

type Worker = { start: () => unknown; stop: () => unknown }
const workers: unknown[] = []
const loaders: Promise<unknown>[] = []
const validate = mock(() => {})
const realtime = mock(() => {})
const handlers: ((input: {
    next: (options: unknown) => Promise<{ response: Response }>
}) => Promise<{ response: Response }>)[] = []
let csrfFilter: ((context: { handlerType: string }) => boolean) | undefined
const nonce = 'fixture-nonce'
const headers = new Headers({ 'content-security-policy': `nonce-${nonce}` })
const secured = new Response('secured')
const securityHeaders = mock((_protocol: string, _nonce: string) => headers)
const applyHeaders = mock((_response: Response, _headers: Headers) => secured)
const responseHeaders = mock((_headers: Headers) => {})
const protocol = mock((_options: unknown) => 'https')
const reconcileProxy = mock(() => {})
const discovery = { start: mock(() => {}), stop: mock(() => {}) }
const reconcileCrowdsec = mock(() => {})
const certificateStart = mock(() => {})
const certificateStop = mock(() => {})
const jobsStart = mock(() => {})
const jobsStop = mock(() => {})
const backup = { start: mock(() => {}), stop: mock(() => {}) }
const notification = { start: mock(() => {}), stop: mock(() => {}) }
const monitor = { start: mock(() => {}), stop: mock(() => {}) }
let releasePrune: (() => void) | undefined
const prune = mock(
    () =>
        new Promise<void>((resolve) => {
            releasePrune = resolve
        }),
)
mock.module('@tanstack/react-start', () => ({
    createServerOnlyFn: (callback: unknown) => callback,
    createMiddleware: () => ({
        server: (callback: (typeof handlers)[number]) => {
            handlers.push(callback)
            return callback
        },
    }),
    createCsrfMiddleware: ({ filter }: { filter: typeof csrfFilter }) => {
        csrfFilter = filter
        return 'csrf'
    },
    createStart: (factory: () => unknown) => factory(),
}))
mock.module('@tanstack/react-start/server', () => ({
    getRequestProtocol: protocol,
    setResponseHeaders: responseHeaders,
}))
mock.module('@/server/env.server.ts', () => ({
    getTrustProxyHeaders: () => true,
    validateProductionEnvironment: validate,
}))
mock.module('@/server/WebSockets/realtimeValkey.service.ts', () => ({
    startRealtimeValkey: realtime,
}))
mock.module('@/server/Foundation/worker-lifecycle.server.ts', () => ({
    startWorkerLifecycle: (loader: () => Promise<unknown>) => {
        const result = loader().then((worker) => {
            workers.push(worker)
            return worker
        })
        loaders.push(result)
        return result
    },
}))
mock.module('@/server/security-headers.ts', () => ({
    createCspNonce: () => nonce,
    getAdminUiSecurityHeaders: securityHeaders,
    applyAdminUiSecurityHeaders: applyHeaders,
}))
mock.module('@/server/ProxyRuntime/proxy-runtime.service.ts', () => ({
    reconcileProxyConfigurationService: reconcileProxy,
}))
mock.module('@/server/Admin/DockerDiscovery/discovery-worker.ts', () => ({
    dockerDiscoveryWorker: discovery,
}))
mock.module('@/server/Admin/CrowdSec/crowdsec.service.ts', () => ({
    reconcileCrowdSecConfiguration: reconcileCrowdsec,
}))
mock.module('@/server/Admin/CertificateManagement/certificate-events.worker.ts', () => ({
    startCertificateEventsSynchronization: certificateStart,
    stopCertificateEventsSynchronization: certificateStop,
}))
mock.module('@/server/Admin/ProxyHostManagement/certificate-jobs.worker.server.ts', () => ({
    startCertificateJobWorker: jobsStart,
    stopCertificateJobWorker: jobsStop,
}))
mock.module('@/server/Admin/Backups/backup-outcomes.server.ts', () => ({
    backupOutcomesWorker: backup,
}))
mock.module('@/server/Notifications/notification-worker.server.ts', () => ({
    notificationWorker: notification,
}))
mock.module('@/server/HostMonitoring/host-monitoring.worker.server.ts', () => ({
    hostMonitoringWorker: monitor,
}))
mock.module('@/server/Admin/NpmImport/npm-temp.ts', () => ({ pruneStaleNpmImports: prune }))

test('server bootstrap validates production, binds every worker and coalesces temporary-file pruning with stop cleanup', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const interval = spyOn(globalThis, 'setInterval')
    const clear = spyOn(globalThis, 'clearInterval')
    let cleanup: Worker | undefined
    try {
        const { startInstance } = await import('@/start.ts')
        await Promise.all(loaders)
        expect(validate).toHaveBeenCalledTimes(1)
        expect(realtime).toHaveBeenCalledTimes(1)
        expect(workers).toHaveLength(9)
        for (const worker of [
            reconcileProxy,
            discovery,
            reconcileCrowdsec,
            backup,
            notification,
            monitor,
        ])
            expect(workers).toContain(worker)
        expect(workers).toContainEqual({ start: certificateStart, stop: certificateStop })
        expect(workers).toContainEqual({ start: jobsStart, stop: jobsStop })
        cleanup = workers.find(
            (worker) =>
                typeof worker === 'object' &&
                worker !== null &&
                'start' in worker &&
                ![discovery, backup, notification, monitor].includes(worker as typeof discovery) &&
                (worker as Worker).start !== certificateStart &&
                (worker as Worker).start !== jobsStart,
        ) as Worker
        cleanup.start()
        expect(prune).toHaveBeenCalledTimes(1)
        expect(interval).toHaveBeenCalledWith(expect.any(Function), 3_600_000)
        const tick = interval.mock.calls.at(-1)?.[0]
        if (typeof tick !== 'function') throw new Error('Cleanup interval missing')
        tick()
        tick()
        expect(prune).toHaveBeenCalledTimes(1)
        releasePrune?.()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        tick()
        expect(prune).toHaveBeenCalledTimes(2)
        releasePrune?.()
        await cleanup.stop()
        expect(clear).toHaveBeenCalledTimes(1)
        cleanup = undefined
        const configured: unknown = startInstance
        expect(configured).toEqual({ requestMiddleware: [handlers[0], 'csrf'] })
        expect(csrfFilter?.({ handlerType: 'serverFn' })).toBe(true)
        expect(csrfFilter?.({ handlerType: 'router' })).toBe(false)
        const original = new Response('original')
        const next = mock(async (_options: unknown) => ({ response: original }))
        const result = await handlers[0]!({ next })
        expect(next).toHaveBeenCalledWith({ context: { cspNonce: nonce } })
        expect(protocol).toHaveBeenCalledWith({ xForwardedProto: true })
        expect(securityHeaders).toHaveBeenCalledWith('https', nonce)
        expect(responseHeaders).toHaveBeenCalledWith(expect.any(Headers))
        expect(applyHeaders).toHaveBeenCalledWith(original, headers)
        expect(result.response).toBe(secured)
    } finally {
        releasePrune?.()
        if (cleanup) await cleanup.stop()
        interval.mockRestore()
        clear.mockRestore()
        if (previous === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = previous
    }
})
