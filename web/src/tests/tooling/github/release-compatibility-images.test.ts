// oxlint-disable no-await-in-loop -- Exercise each independent invalid image label in order.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createCompatibilityImages } from '../../../../../.github/scripts/ci/release-compatibility/images.ts'
import { buildHttp3Client } from '../../../../../scripts/smoke/http3/client.ts'
import type { ApplianceCommand } from '../../../../../.github/scripts/ci/fixtures/Types/appliance-storage.types.ts'

const revision = 'a'.repeat(40)
const imageId = 'sha256:' + 'b'.repeat(64)
const originalReuse = process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES
const originalRun = process.env.RENTNERPROXY_SMOKE_RUN
beforeEach(() => {
    process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES = '1'
    process.env.RENTNERPROXY_SMOKE_RUN = '123-2'
})
afterEach(() => {
    if (originalReuse === undefined) delete process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES
    else process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES = originalReuse
    if (originalRun === undefined) delete process.env.RENTNERPROXY_SMOKE_RUN
    else process.env.RENTNERPROXY_SMOKE_RUN = originalRun
})

function fakeDocker() {
    const calls: string[][] = []
    const labels = {
        'io.rentnerproxy.smoke-run': '123-2',
        'io.rentnerproxy.smoke-source': revision,
        'io.rentnerproxy.smoke-image': 'appliance',
        'org.opencontainers.image.revision': revision,
    }
    const command: ApplianceCommand = async (args) => {
        calls.push(args)
        if (args[0] === 'git') return revision
        if (args[1] === 'build' || args[2] === 'rm') return ''
        if (args[1] === 'run') return 'Features: HTTP2 HTTP3'
        if (args[2] === 'inspect') {
            if (args[4] === '{{.Id}}') return imageId
            if (args[4] === '{{json .Config.Labels}}') return JSON.stringify(labels)
            return labels['org.opencontainers.image.revision']
        }
        throw new Error('Unexpected command')
    }
    return { calls, labels, command }
}

test('compatibility reuses verified immutable appliance and client without build or producer cleanup', async () => {
    const docker = fakeDocker()
    const images = createCompatibilityImages('consumer', true)
    expect(images.targetImage).toBe('rentnerproxy-smoke-123-2:appliance')
    expect(images.http3Image).toBe('rentnerproxy-smoke-123-2:http3-client')
    expect(
        await images.prepareTarget(docker.command, { revision, context: '/archived-source' }),
    ).toBe(imageId)
    docker.labels['io.rentnerproxy.smoke-image'] = 'http3-client'
    await buildHttp3Client((args) => docker.command(args), images.http3Image)
    await images.cleanup(docker.command)
    expect(docker.calls.some((args) => args[1] === 'build' || args[2] === 'rm')).toBeFalse()
})

test('compatibility rejects foreign run, source, kind and revision without rebuilding or deleting', async () => {
    for (const key of [
        'io.rentnerproxy.smoke-run',
        'io.rentnerproxy.smoke-source',
        'io.rentnerproxy.smoke-image',
        'org.opencontainers.image.revision',
    ] as const) {
        const docker = fakeDocker()
        docker.labels[key] = 'foreign'
        const images = createCompatibilityImages('consumer', true)
        await expect(
            images.prepareTarget(docker.command, { revision, context: '/archived-source' }),
        ).rejects.toThrow()
        await images.cleanup(docker.command)
        expect(docker.calls.some((args) => args[1] === 'build' || args[2] === 'rm')).toBeFalse()
    }
})

test('fresh compatibility requires only the shared appliance', async () => {
    const docker = fakeDocker()
    const images = createCompatibilityImages('consumer', false)
    await images.prepareTarget(docker.command, { revision, context: '/archived-source' })
    await images.cleanup(docker.command)
    expect(
        docker.calls
            .filter((args) => args[0] === 'docker')
            .every((args) => args.at(-1) === images.targetImage),
    ).toBeTrue()
})

test('missing shared appliance fails closed and preserves producer ownership', async () => {
    const docker = fakeDocker()
    const images = createCompatibilityImages('consumer', false)
    const command: ApplianceCommand = (args) =>
        args[2] === 'inspect' ? Promise.reject(new Error('Image missing')) : docker.command(args)
    await expect(
        images.prepareTarget(command, { revision, context: '/archived-source' }),
    ).rejects.toThrow('Image missing')
    await images.cleanup(command)
    expect(docker.calls.some((args) => args[1] === 'build' || args[2] === 'rm')).toBeFalse()
})

test('standalone compatibility builds the archived source and removes only its owned images', async () => {
    delete process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES
    const docker = fakeDocker()
    const images = createCompatibilityImages('consumer', true)
    expect(
        await images.prepareTarget(docker.command, { revision, context: '/archived-source' }),
    ).toBe(imageId)
    await buildHttp3Client((args) => docker.command(args), images.http3Image)
    await images.cleanup(docker.command)
    const builds = docker.calls.filter((args) => args[1] === 'build')
    expect(builds).toHaveLength(2)
    expect(builds[0]).toContain('/archived-source')
    expect(builds[0]).toContain('org.opencontainers.image.revision=' + revision)
    expect(docker.calls.filter((args) => args[2] === 'rm').map((args) => args.at(-1))).toEqual([
        images.targetImage,
        images.http3Image,
    ])
})

test('prebuilt appliance must resolve to an immutable image identity', async () => {
    const docker = fakeDocker()
    const images = createCompatibilityImages('consumer', false)
    const command: ApplianceCommand = (args) =>
        args[4] === '{{.Id}}' ? Promise.resolve('mutable:tag') : docker.command(args)
    await expect(
        images.prepareTarget(command, { revision, context: '/archived-source' }),
    ).rejects.toThrow('invalid target image identity')
})
