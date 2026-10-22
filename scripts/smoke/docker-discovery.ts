// oxlint-disable no-await-in-loop -- Short isolated Docker probes and owned cleanup run sequentially.
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute } from 'node:path'
import { runSmokeProcess } from './process.ts'
import { smokeDockerArguments } from './resources.ts'
import {
    DOCKER_DISCOVERY_COMPOSE_EXAMPLE,
    DOCKER_DISCOVERY_NATIVE_EXAMPLE,
} from '../../web/src/config/docker-discovery.config.ts'

// Optional socket-proxy ACL smoke. No real engine socket or production volume is mounted.
const root = fileURLToPath(new URL('../../', import.meta.url))
const name = 'rentnerproxy-discovery-' + crypto.randomUUID().slice(0, 8)
const directory = resolve(root, 'tmp', name)
const network = name + '-network'
const volume = name + '-socket'
const engine = name + '-engine'
const proxy = name + '-proxy'
const bun =
    'mirror.gcr.io/oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d'
const haproxy =
    'mirror.gcr.io/library/haproxy:3.2.26@sha256:06843e9d60fcdae4e43ff8e001859249a5352f1b8e522058ce86e6f8cf789507'

async function command(args: string[], timeoutMs = 30_000) {
    const result = await runSmokeProcess(smokeDockerArguments(['docker', ...args]), {
        cwd: root,
        timeoutMs,
    })
    assert.equal(result.exitCode, 0, result.stderr.slice(0, 2000))
    assert.equal(result.timedOut, false)
    return result.stdout.trim()
}

try {
    await mkdir(directory, { recursive: true })
    const emptyEnvironment = resolve(directory, 'empty.env')
    const baseCompose = resolve(directory, 'base.yml')
    await Bun.write(emptyEnvironment, '')
    await Bun.write(baseCompose, `services:\n  rentnerproxy:\n    image: ${bun}\n`)
    for (const [mode, content] of [
        ['appliance', DOCKER_DISCOVERY_COMPOSE_EXAMPLE],
        ['native', DOCKER_DISCOVERY_NATIVE_EXAMPLE],
    ] as const) {
        const path = resolve(directory, mode + '.yml')
        await Bun.write(path, content)
        const configured = JSON.parse(
            await command([
                'compose',
                '--project-directory',
                directory,
                '--env-file',
                emptyEnvironment,
                ...(mode === 'appliance' ? ['-f', baseCompose] : []),
                '-f',
                path,
                'config',
                '--format',
                'json',
            ]),
        )
        const api = configured.services['docker-api']
        const app = configured.services['example-app']
        assert.deepEqual(Object.keys(api.networks), ['discovery-control'])
        assert.deepEqual(Object.keys(app.networks), ['proxy'])
        assert.equal(configured.networks['discovery-control'].internal, true)
        assert.equal(app.labels['rentnerproxy.network'], configured.networks.proxy.name)
        assert.equal(api.read_only, true)
        assert.deepEqual(api.cap_drop, ['ALL'])
        assert.equal(
            api.volumes.find((mount: { target: string }) => mount.target === '/var/run/docker.sock')
                ?.read_only,
            true,
        )
        assert.equal(app.volumes, undefined)
        if (mode === 'appliance') {
            assert.equal(api.ports, undefined)
            assert.deepEqual(Object.keys(configured.services.rentnerproxy.networks).toSorted(), [
                'default',
                'discovery-control',
                'proxy',
            ])
        } else {
            assert.equal(api.ports.length, 1)
            assert.equal(api.ports[0].host_ip, '127.0.0.1')
            assert.equal(api.ports[0].published, '2375')
        }
    }
    console.log(
        'Docker discovery UI Compose examples: isolated rendering, restricted API and separate application networks passed',
    )
    await Bun.write(
        resolve(directory, 'engine.ts'),
        `
        Bun.serve({ unix: '/fixture/docker.sock', fetch(request) {
            return Response.json({ method: request.method, path: new URL(request.url).pathname })
        } })
    `,
    )
    await Bun.write(
        resolve(directory, 'probe.ts'),
        `
        const base = 'http://${proxy}:2375'
        const id = 'a'.repeat(64)
        let proxyReady = false
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                const response = await fetch(base + '/v1.47/containers/json', { signal: AbortSignal.timeout(500), redirect: 'error' })
                proxyReady = response.status === 200
                await response.body?.cancel()
                if (proxyReady) break
            } catch { /* The detached proxy may still be starting. */ }
            await Bun.sleep(100)
        }
        if (!proxyReady) throw new Error('Isolated socket proxy did not become ready within the bounded startup retries')
        const allowed = ['/v1.47/containers/json?all=1', '/v1.47/containers/' + id + '/json', '/v1.47/events']
        for (const path of allowed) {
            const response = await fetch(base + path, { signal: AbortSignal.timeout(3000), redirect: 'error' })
            if (response.status !== 200) throw new Error('Allowed read rejected: ' + path + ': ' + response.status)
            const data = await response.json()
            if (data.method !== 'GET' || data.path !== path.split('?')[0]) throw new Error('Unexpected upstream request')
        }
        const denied = [
            ['POST', '/v1.47/containers/create'], ['POST', '/v1.47/containers/' + id + '/start'],
            ['POST', '/v1.47/containers/' + id + '/stop'], ['POST', '/v1.47/containers/' + id + '/exec'],
            ['DELETE', '/v1.47/containers/' + id], ['POST', '/v1.47/images/create'], ['POST', '/v1.47/volumes/create'],
            ['POST', '/v1.47/events'], ['DELETE', '/v1.47/containers/json'], ['HEAD', '/v1.47/events'],
            ['GET', '/v1.47/containers/' + id + '/logs'], ['GET', '/v1.47/containers/' + id + '/archive?path=/etc'],
            ['GET', '/v1.47/images/json'], ['GET', '/v1.47/volumes'], ['GET', '/version'],
            ['GET', '/v1.47/containers/not-an-id/json'], ['GET', '/v1.47/containers/%61/json'],
            ['GET', '/v1.47/containers/json/extra'], ['GET', '/v1.47/containers/json;extra'],
        ]
        for (const [method, path] of denied) {
            const response = await fetch(base + path, { method, signal: AbortSignal.timeout(3000), redirect: 'error' })
            if (response.status !== 403) throw new Error('Forbidden operation accepted: ' + method + ' ' + path)
            await response.body?.cancel()
        }
        console.log('Docker discovery socket proxy: 3 allowed reads and 19 denied operations passed')
    `,
    )
    await command(['pull', haproxy], 180_000)
    await command(['pull', bun], 180_000)
    await command([
        'run',
        '--rm',
        '--network',
        'none',
        '--mount',
        `type=bind,source=${resolve(root, 'docker/discovery/haproxy.cfg')},target=/usr/local/etc/haproxy/haproxy.cfg,readonly`,
        haproxy,
        'haproxy',
        '-c',
        '-f',
        '/usr/local/etc/haproxy/haproxy.cfg',
    ])
    await command(['network', 'create', '--internal', network])
    await command(['volume', 'create', volume])
    await command([
        'run',
        '--detach',
        '--name',
        engine,
        '--network',
        network,
        '--user',
        '0:0',
        '--mount',
        `type=volume,source=${volume},target=/fixture`,
        '--mount',
        `type=bind,source=${directory},target=/smoke,readonly`,
        bun,
        'bun',
        '--no-env-file',
        '/smoke/engine.ts',
    ])
    let socketReady = false
    for (let attempt = 0; attempt < 30; attempt++) {
        const result = await command([
            'exec',
            engine,
            'bun',
            '--no-env-file',
            '-e',
            `import { existsSync } from 'node:fs'; console.log(existsSync('/fixture/docker.sock'))`,
        ])
        if (result === 'true') {
            socketReady = true
            break
        }
        await Bun.sleep(100)
    }
    assert.ok(socketReady, 'isolated mock Docker socket becomes ready')
    await command([
        'run',
        '--detach',
        '--name',
        proxy,
        '--network',
        network,
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--user',
        '0:0',
        '--mount',
        `type=volume,source=${volume},target=/var/run,readonly`,
        '--mount',
        `type=bind,source=${resolve(root, 'docker/discovery/haproxy.cfg')},target=/usr/local/etc/haproxy/haproxy.cfg,readonly`,
        haproxy,
    ])
    console.log(
        await command([
            'run',
            '--rm',
            '--network',
            network,
            '--mount',
            `type=bind,source=${directory},target=/smoke,readonly`,
            bun,
            'bun',
            '--no-env-file',
            '/smoke/probe.ts',
        ]),
    )
} finally {
    for (const args of [
        ['rm', '--force', proxy, engine],
        ['volume', 'rm', volume],
        ['network', 'rm', network],
    ]) {
        await runSmokeProcess(['docker', ...args], { cwd: root, timeoutMs: 30_000 })
    }
    const within = relative(resolve(root, 'tmp'), directory)
    assert.ok(
        within && !isAbsolute(within) && !within.startsWith('..'),
        'cleanup stays in owned workspace tmp directory',
    )
    await rm(directory, { recursive: true, force: true })
}
