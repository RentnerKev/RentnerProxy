import {
    createCsrfMiddleware,
    createMiddleware,
    createServerOnlyFn,
    createStart,
} from '@tanstack/react-start'
import { getRequestProtocol, setResponseHeaders } from '@tanstack/react-start/server'

import { getTrustProxyHeaders, validateProductionEnvironment } from './server/env.server'
import { getAdminUiSecurityHeaders } from './server/security-headers'

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
    // serve.mjs emits this before exit and awaits every promise pushed into the array.
    // Register synchronously so shutdown during module initialization still drains safely.
    process.once('rentnerproxy:shutdown', (pending: Array<Promise<void>>) => {
        pending.push(initializing.then(() => stop?.()).then(() => undefined))
    })
    await initializing
})

if (typeof window === 'undefined') void startProxyRuntimeLifecycle()

const securityHeadersMiddleware = createMiddleware().server(({ next }) => {
    setResponseHeaders(
        getAdminUiSecurityHeaders(
            getRequestProtocol({ xForwardedProto: getTrustProxyHeaders() }),
        ) as unknown as Parameters<typeof setResponseHeaders>[0],
    )
    return next()
})

const csrfMiddleware = createCsrfMiddleware({
    filter: (context) => context.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
    requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}))
