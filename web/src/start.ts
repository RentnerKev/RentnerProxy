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
