// oxlint-disable no-await-in-loop -- Each rejection mutates and restores a different image label.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
    sharedSmokeImage,
    prepareSmokeImages,
    verifySharedSmokeImage,
} from '../../../../../scripts/smoke/images.ts'
import { buildHttp3Client } from '../../../../../scripts/smoke/http3/client.ts'
import type { Http3Command } from '../../../../../scripts/smoke/http3/Types/client.types.ts'

const revision = 'a'.repeat(40)
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
    const images = new Map<string, Record<string, string>>()
    let features = 'Features: HTTP2 HTTP3'
    const command: Http3Command = async (args) => {
        calls.push(args)
        if (args[0] === 'git') return revision
        if (args[1] === 'build') {
            const labels: Record<string, string> = {}
            for (let index = 0; index < args.length; index += 1) {
                if (args[index] === '--label') {
                    const [key, value] = args[index + 1]!.split('=')
                    labels[key!] = value!
                }
            }
            images.set(args[args.indexOf('--tag') + 1]!, labels)
            return ''
        }
        if (args[1] === 'image') {
            const labels = images.get(args.at(-1)!)
            if (!labels) throw new Error('Image missing')
            return JSON.stringify(labels)
        }
        if (args[1] === 'run') return features
        throw new Error('Unexpected command')
    }
    return {
        calls,
        images,
        command,
        setFeatures(value: string) {
            features = value
        },
    }
}

test('prepare builds all three contracts once; later HTTP3 clients only verify ownership', async () => {
    const docker = fakeDocker()
    await prepareSmokeImages(docker.command)
    await buildHttp3Client(docker.command, sharedSmokeImage('http3-client')!)
    await buildHttp3Client(docker.command, sharedSmokeImage('http3-client')!)
    expect(
        docker.calls
            .filter((args) => args[1] === 'build')
            .map((args) => args[args.indexOf('--file') + 1]),
    ).toEqual([
        'docker/proxy-runtime/Dockerfile',
        'docker/production/Dockerfile',
        'scripts/smoke/http3/Dockerfile',
    ])
    expect(docker.calls.filter((args) => args[1] === 'run')).toHaveLength(1)
    expect(docker.images.size).toBe(3)
})

test('requires explicit opt-in and validated scope; standalone HTTP3 still builds and probes', async () => {
    const docker = fakeDocker()
    delete process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES
    expect(sharedSmokeImage('appliance')).toBeUndefined()
    await buildHttp3Client(docker.command, 'standalone-http3')
    expect(docker.calls.filter((args) => args[1] === 'build')).toHaveLength(1)
    expect(docker.calls.filter((args) => args[1] === 'run')).toHaveLength(1)
    process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES = '1'
    delete process.env.RENTNERPROXY_SMOKE_RUN
    expect(() => sharedSmokeImage('appliance')).toThrow()
    process.env.RENTNERPROXY_SMOKE_RUN = '../other-run'
    expect(() => sharedSmokeImage('appliance')).toThrow()
})

test('reuse rejects missing, foreign-run, foreign-source and wrong-kind images without rebuilding', async () => {
    const docker = fakeDocker()
    await expect(verifySharedSmokeImage(docker.command, 'appliance')).rejects.toThrow(
        'Image missing',
    )
    await prepareSmokeImages(docker.command)
    const labels = docker.images.get(sharedSmokeImage('appliance')!)!
    for (const key of [
        'io.rentnerproxy.smoke-run',
        'io.rentnerproxy.smoke-source',
        'io.rentnerproxy.smoke-image',
    ]) {
        const original = labels[key]!
        labels[key] = 'foreign'
        await expect(verifySharedSmokeImage(docker.command, 'appliance')).rejects.toThrow()
        labels[key] = original
    }
    expect(docker.calls.filter((args) => args[1] === 'build')).toHaveLength(3)
})

test('prepare rejects a client missing HTTP3 capability', async () => {
    const docker = fakeDocker()
    docker.setFeatures('Features: HTTP2')
    await expect(prepareSmokeImages(docker.command)).rejects.toThrow()
})
