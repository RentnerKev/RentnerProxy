import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'
import {
    getDockerDiscoveryService,
    saveDockerDiscoveryService,
} from '@/server/Admin/DockerDiscovery/docker-discovery.service.ts'
import { DockerDiscoveryError } from '@/server/Admin/DockerDiscovery/docker-discovery.errors.ts'
import { localizedActionFailure, throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'
import { saveDockerDiscoverySchema } from '@/lib/DockerDiscovery/validation.ts'

export function validateDockerDiscoveryInput(input: unknown) {
    const parsed = saveDockerDiscoverySchema.safeParse(input)
    if (!parsed.success) throw new Error('admin.dockerDiscovery.errors.invalid_input')
    return parsed.data
}
export const getDockerDiscoveryHandler = createServerFn({ method: 'GET' }).handler(async () => {
    setResponseHeader('Cache-Control', 'private, no-store')
    try {
        return await getDockerDiscoveryService()
    } catch (error) {
        throwLocalizedQueryError(error, 'admin.dockerDiscovery.errors.controller_unavailable')
    }
})
export const saveDockerDiscoveryHandler = createServerFn({ method: 'POST' })
    .validator(validateDockerDiscoveryInput)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return { success: true as const, value: await saveDockerDiscoveryService(data) }
        } catch (error) {
            if (!(error instanceof DockerDiscoveryError))
                return localizedActionFailure(
                    error,
                    'admin.dockerDiscovery.errors.controller_unavailable',
                )
            setResponseStatus(
                error.code === 'conflict' ? 409 : error.code === 'invalid_input' ? 422 : 503,
            )
            return {
                success: false as const,
                message: `admin.dockerDiscovery.errors.${error.code}`,
            }
        }
    })
