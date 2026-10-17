// oxlint-disable no-await-in-loop -- Short isolated Docker probes and owned cleanup run sequentially.
import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative, isAbsolute } from 'node:path'
import { runSmokeProcess } from './process.ts'
import { smokeDockerArguments } from './resources.ts'

// Optional socket-proxy ACL smoke. No real engine socket or production volume is mounted.
const root = fileURLToPath(new URL('../../', import.meta.url))
const name = 'rentnerproxy-discovery-' + crypto.randomUUID().slice(0, 8)
const directory = resolve(root, 'tmp', name)
const network = name + '-network'
const volume = name + '-socket'
const engine = name + '-engine'
const proxy = name + '-proxy'
const bun =
    'mirror.gcr.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598'
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
