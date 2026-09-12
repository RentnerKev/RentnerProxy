import {
    createCsrfMiddleware,
    createMiddleware,
    createServerOnlyFn,
    createStart,
} from '@tanstack/react-start'
import { getRequestProtocol, setResponseHeaders } from '@tanstack/react-start/server'

import { getTrustProxyHeaders, validateProductionEnvironment } from './server/env.server'
import {
    applyAdminUiSecurityHeaders,
    createCspNonce,
    getAdminUiSecurityHeaders,
} from './server/security-headers'

const validateProductionEnvironmentAtStartup = createServerOnlyFn(() => {
    if (process.env.NODE_ENV === 'production') validateProductionEnvironment()
})

if (typeof window === 'undefined') validateProductionEnvironmentAtStartup()

const startProxyRuntimeLifecycle = createServerOnlyFn(async () => {
    let stop: (() => Promise<void>) | null = null
    const initializing = import('./server/ProxyRuntime/proxy-runtime.service').then(
        ({ startProxyRuntimeReconciliation, stopProxyRuntimeReconciliation }) => {
            stop = stopProxyRuntimeReconciliation
            startProxyRuntimeReconciliation()
        },
    )

    process.once('rentnerproxy:shutdown', (pending: Array<Promise<void>>) => {
        pending.push(initializing.then(() => stop?.()).then(() => undefined))
    })
    await initializing
})

if (typeof window === 'undefined') void startProxyRuntimeLifecycle()

const startCertificateEventsLifecycle = createServerOnlyFn(async () => {
    let stop: (() => Promise<void>) | null = null
    const initializing =
        import('./server/Admin/CertificateManagement/certificate-events.worker').then(
            ({ startCertificateEventsSynchronization, stopCertificateEventsSynchronization }) => {
                stop = stopCertificateEventsSynchronization
                startCertificateEventsSynchronization()
            },
        )

    process.once('rentnerproxy:shutdown', (pending: Array<Promise<void>>) => {
        pending.push(initializing.then(() => stop?.()).then(() => undefined))
    })
    await initializing
})

if (typeof window === 'undefined') void startCertificateEventsLifecycle()

const startCertificateJobsLifecycle = createServerOnlyFn(async () => {
    let stop: (() => Promise<void>) | null = null
    const initializing =
        import('./server/Admin/ProxyHostManagement/certificate-jobs.worker.server').then(
            ({ startCertificateJobWorker, stopCertificateJobWorker }) => {
                stop = stopCertificateJobWorker
                startCertificateJobWorker()
            },
        )
    process.once('rentnerproxy:shutdown', (pending: Array<Promise<void>>) => {
        pending.push(initializing.then(() => stop?.()).then(() => undefined))
    })
    await initializing
})

if (typeof window === 'undefined') void startCertificateJobsLifecycle()

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
