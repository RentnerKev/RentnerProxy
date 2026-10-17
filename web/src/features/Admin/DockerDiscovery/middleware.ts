import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import { DockerDiscoveryError } from '@/server/Admin/DockerDiscovery/docker-discovery.errors.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import {
    discoveryActionSchema,
    discoveryConnectSchema,
    discoveryInspectSchema,
} from '@/lib/DockerDiscovery/management.ts'
import {
    getDiscoveryOverviewService,
    connectDiscoveryService,
    inspectDiscoveryService,
    changeDiscoveryService,
} from '@/server/Admin/DockerDiscovery/discovery-management.service.ts'

async function discoveryAction<T>(action: () => Promise<T>) {
    setResponseHeader('Cache-Control', 'private, no-store')
    try {
        return { success: true as const, value: await action() }
    } catch (error) {
        if (!(error instanceof DockerDiscoveryError))
            return localizedActionFailure(
                error,
                'admin.dockerDiscovery.errors.controller_unavailable',
            )
        setResponseStatus(
            error.code === 'conflict' ? 409 : error.code === 'invalid_input' ? 422 : 503,
        )
        return { success: false as const, message: `admin.dockerDiscovery.errors.${error.code}` }
    }
}
export const getDiscoveryOverviewHandler = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeader('Cache-Control', 'private, no-store')
    try {
        return await getDiscoveryOverviewService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.dockerDiscovery.errors.controller_unavailable')
    }
})
export const connectDiscoveryHandler = createServerFn({ method: 'POST' })
    .validator(discoveryConnectSchema)
    .handler(({ data }) => discoveryAction(() => connectDiscoveryService(data)))
export const inspectDiscoveryHandler = createServerFn({ method: 'POST' })
    .validator(discoveryInspectSchema)
    .handler(({ data }) => discoveryAction(() => inspectDiscoveryService(data)))
export const changeDiscoveryHandler = createServerFn({ method: 'POST' })
    .validator(discoveryActionSchema)
    .handler(({ data }) => discoveryAction(() => changeDiscoveryService(data)))
