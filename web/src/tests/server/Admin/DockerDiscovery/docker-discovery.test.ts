import { describe, expect, mock, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { DockerDiscoverySnapshot } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import { createDockerDiscoveryService } from '@/server/Admin/DockerDiscovery/docker-discovery.service.ts'
import { DockerDiscoveryError } from '@/server/Admin/DockerDiscovery/docker-discovery.errors.ts'
import { validateDockerDiscoveryInput } from '@/features/Admin/DockerDiscovery/middleware.ts'
import { dockerEndpointSchema } from '@/lib/DockerDiscovery/validation.ts'

const actor = '0198d98a-0000-7000-8000-000000000001'
const input = {
    expectedRevision: 0,
    configuration: { enabled: true, endpoint: 'http://docker-proxy:2375' },
    acknowledgeRestore: false,
}
const snapshot: DockerDiscoverySnapshot = {
    configuration: { version: 1, revision: 1, settings: input.configuration },
    status: 'connecting',
    stale: true,
    error: null,
    candidates: [],
}
function setup(permissions: PermissionKey[]) {
    const dependencies = {
        authorize: mock(async (permission: PermissionKey) => {
            if (!permissions.includes(permission)) throw new Error('denied')
            return { id: actor }
        }),
        controller: { status: mock(async () => snapshot), save: mock(async () => snapshot) },
        limit: mock(async () => {}),
        audit: mock(async () => {}),
    }
    return { dependencies, service: createDockerDiscoveryService(dependencies) }
}
describe('Docker discovery management boundary', () => {
    test('view and manage are independent and denied before any controller access', async () => {
        const viewer = setup([PERMISSIONS.DOCKER_DISCOVERY_VIEW])
        expect(await viewer.service.getDockerDiscoveryService()).toEqual(snapshot)
        await expect(viewer.service.saveDockerDiscoveryService(input)).rejects.toThrow('denied')
        expect(viewer.dependencies.controller.save).not.toHaveBeenCalled()
        expect(viewer.dependencies.limit).not.toHaveBeenCalled()
        const manager = setup([PERMISSIONS.DOCKER_DISCOVERY_MANAGE])
        await expect(manager.service.getDockerDiscoveryService()).rejects.toThrow('denied')
        expect(manager.dependencies.controller.status).not.toHaveBeenCalled()
        await manager.service.saveDockerDiscoveryService(input)
        expect(manager.dependencies.controller.save).toHaveBeenCalledWith({
            ...input,
            actorUserId: actor,
        })
    })
    test('audits outcomes without connection addresses and redacts unexpected provider errors', async () => {
        const { dependencies, service } = setup([PERMISSIONS.DOCKER_DISCOVERY_MANAGE])
        await service.saveDockerDiscoveryService(input)
        expect(dependencies.audit).toHaveBeenCalledWith({
            actorUserId: actor,
            actorKind: 'user',
            action: 'update',
            resource: 'security-settings',
            targetId: null,
            result: 'success',
            metadata: { changedFields: ['dockerDiscovery'] },
        })
        dependencies.controller.save.mockRejectedValue(
            new Error('http://internal-address/private-metadata'),
        )
        await expect(service.saveDockerDiscoveryService(input)).rejects.toThrow(
            'admin.dockerDiscovery.errors.controller_unavailable',
        )
        expect(JSON.stringify(dependencies.audit.mock.calls)).not.toContain('docker-proxy')
        expect(JSON.stringify(dependencies.audit.mock.calls)).not.toContain('internal-address')
    })
    test('rejects actor injection and arbitrary credential-bearing input without serialization', () => {
        expect(() => validateDockerDiscoveryInput({ ...input, actorUserId: actor })).toThrow(
            'invalid_input',
        )
        expect(() =>
            validateDockerDiscoveryInput({
                ...input,
                configuration: { enabled: true, endpoint: 'http://name:secret@docker:2375' },
            }),
        ).toThrow('admin.dockerDiscovery.errors.invalid_input')
        expect(() =>
            validateDockerDiscoveryInput({
                ...input,
                configuration: { enabled: true, endpoint: null },
            }),
        ).toThrow('invalid_input')
    })
    test('rate limits block writes and known domain errors retain only their allowlisted code', async () => {
        const { dependencies, service } = setup([PERMISSIONS.DOCKER_DISCOVERY_MANAGE])
        dependencies.limit.mockRejectedValueOnce(new Error('rate limited'))
        await expect(service.saveDockerDiscoveryService(input)).rejects.toThrow('rate limited')
        expect(dependencies.controller.save).not.toHaveBeenCalled()
        dependencies.controller.save.mockRejectedValueOnce(new DockerDiscoveryError('conflict'))
        await expect(service.saveDockerDiscoveryService(input)).rejects.toThrow(
            'admin.dockerDiscovery.errors.conflict',
        )
    })
    test.each([
        'unix:///var/run/docker.sock',
        'tcp://docker:2375',
        'http://docker/path',
        'http://docker/?',
        'http://docker/#',
        'http://docker:0',
        'http://docker/\n',
        'http://user:secret@docker:2375',
    ])('rejects unsupported endpoint %s', (value) => {
        expect(dockerEndpointSchema.safeParse(value).success).toBe(false)
    })
})
