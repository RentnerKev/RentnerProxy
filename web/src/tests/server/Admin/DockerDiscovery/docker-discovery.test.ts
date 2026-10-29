import { describe, expect, test } from 'bun:test'
import {
    dockerEndpointSchema,
    saveDockerDiscoverySchema,
} from '@/lib/DockerDiscovery/validation.ts'

const input = {
    expectedRevision: 0,
    configuration: { enabled: true, endpoint: 'http://docker-proxy:2375' },
    acknowledgeRestore: false,
}

describe('Docker discovery configuration validation', () => {
    test('rejects actor injection and credential-bearing or incomplete configuration', () => {
        expect(
            saveDockerDiscoverySchema.safeParse({ ...input, actorUserId: 'forged' }).success,
        ).toBe(false)
        expect(
            saveDockerDiscoverySchema.safeParse({
                ...input,
                configuration: { enabled: true, endpoint: 'http://name:secret@docker:2375' },
            }).success,
        ).toBe(false)
        expect(
            saveDockerDiscoverySchema.safeParse({
                ...input,
                configuration: { enabled: true, endpoint: null },
            }).success,
        ).toBe(false)
    })

    test.each([
        'unix://docker/var/run/docker.sock',
        'unix:/var/run/docker.sock',
        'unix://user:secret@docker/var/run/docker.sock',
        'unix:///',
        'unix:////var/run/docker.sock',
        'unix:///var/run/',
        'unix:///var/../run/docker.sock',
        'unix:///var/./run/docker.sock',
        'unix:///var//run/docker.sock',
        'unix:///var/run/docker.sock?query',
        'unix:///var/run/docker.sock#fragment',
        'unix:///var/run/docker%2esock',
        'unix:///var/run/docker\\sock',
        'unix:///var/run/docker\0sock',
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

    test.each(['unix:///var/run/docker.sock', 'unix:///run/user/1000/docker-engine'])(
        'accepts a local Unix socket endpoint %s',
        (endpoint) => {
            expect(dockerEndpointSchema.safeParse(endpoint).success).toBe(true)
            expect(
                saveDockerDiscoverySchema.safeParse({
                    ...input,
                    configuration: { enabled: true, endpoint },
                }).success,
            ).toBe(true)
        },
    )
})
