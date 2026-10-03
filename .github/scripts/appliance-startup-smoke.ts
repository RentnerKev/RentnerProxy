// oxlint-disable no-await-in-loop -- Continuous probes and startup gates are bounded sequential checks.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { join } from 'node:path'

import type {
    ApplianceStartupSmokeOptions,
    StartupProbe,
} from './Types/appliance-startup-smoke.types.ts'

export function probeStartupRoute(
    protocol: 'http' | 'https',
    port: number,
    domain: string,
    marker: string,
    timeoutMs = 700,
    ca?: string,
): Promise<StartupProbe> {
    const started = performance.now()
    return new Promise((resolve) => {
        let finished = false
        const complete = (ok: boolean) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            resolve({ ok, elapsedMs: Math.round(performance.now() - started) })
        }
        const request = (protocol === 'https' ? httpsRequest : httpRequest)(
            {
                hostname: '127.0.0.1',
                port,
                path: '/appliance-startup-probe',
                headers: { Host: domain },
                agent: false,
                ...(protocol === 'https' ? { servername: domain, ca } : {}),
            },
            (response) => {
                let body = ''
                response.setEncoding('utf8')
                response.on('data', (chunk: string) => {
                    body += chunk
                    if (body.length > 4096) {
                        complete(false)
                        request.destroy()
                    }
                })
                response.on('error', () => complete(false))
                response.on('end', () => complete(response.statusCode === 200 && body === marker))
            },
        )
        const timer = setTimeout(() => {
            complete(false)
            request.destroy()
        }, timeoutMs)
        request.on('error', () => complete(false))
        request.end()
    })
}

async function waitFor(predicate: () => Promise<boolean>, label: string): Promise<void> {
    const deadline = performance.now() + 30_000
    while (performance.now() < deadline) {
        if (await predicate().catch(() => false)) return
        await Bun.sleep(150)
    }
    throw new Error('Startup smoke timed out: ' + label)
}

export async function verifyApplianceStartup(
    options: ApplianceStartupSmokeOptions,
): Promise<string> {
    const { compose, command, hostDomain, trafficMarker } = options
    const probe = async () =>
        Promise.all([
            probeStartupRoute('http', options.httpPort, hostDomain, trafficMarker),
            probeStartupRoute(
                'https',
                options.httpsPort,
                hostDomain,
                trafficMarker,
                700,
                options.ca,
            ),
        ])
    const entrypoint = (await readFile(options.entrypointFile, 'utf8')).replaceAll('\r\n', '\n')
    let id = await options.containerId([...compose])

    for (const scenario of ['restart', 'recreate', 'postgres', 'valkey'] as const) {
        assert.ok(
            (await probe()).every((sample) => sample.ok),
            'startup probe baseline failed',
        )
        const sampling = new AbortController()
        let successfulSamples = 0
        let unavailableSamples = 0
        const started = performance.now()
        const lastSuccess = [started, started]
        const largestGapMs = [0, 0]
        const recoveredSamples = [0, 0]
        let verifiedRecoveryAt = Infinity
        const sampler = (async () => {
            while (!sampling.signal.aborted && performance.now() - started < 300_000) {
                const samples = await probe()
                const now = performance.now()
                samples.forEach((sample, index) => {
                    if (sample.ok) {
                        successfulSamples += 1
                        largestGapMs[index] = Math.max(
                            largestGapMs[index]!,
                            now - lastSuccess[index]!,
                        )
                        lastSuccess[index] = now
                        if (now >= verifiedRecoveryAt) recoveredSamples[index]! += 1
                    } else unavailableSamples += 1
                })
                await Bun.sleep(150)
            }
        })()
        let gateFile: string | undefined
        try {
            if (scenario === 'restart') {
                await command([...compose, 'restart', 'rentnerproxy'])
            } else if (scenario === 'recreate') {
                await command([...compose, 'up', '--force-recreate', '--detach'])
            } else {
                const directory = join(options.temporaryRoot, 'startup-' + scenario)
                const gateDirectory = join(directory, 'gate')
                await mkdir(gateDirectory, { recursive: true })
                gateFile = join(gateDirectory, 'release')
                const shimFile = join(directory, 'entrypoint.sh')
                const target = '\nstart_' + scenario + '\n'
                assert.equal(entrypoint.split(target).length, 2, 'startup gate target is ambiguous')
                await writeFile(
                    shimFile,
                    entrypoint.replace(
                        target,
                        '\ntouch /run/rentnerproxy/smoke-startup-gate\n' +
                            "wait_for_command 'isolated smoke dependency gate' test -e /smoke-startup-gate/release\n" +
                            'start_' +
                            scenario +
                            '\n',
                    ),
                    { mode: 0o755 },
                )
                const override = join(directory, 'compose.json')
                await writeFile(
                    override,
                    JSON.stringify({
                        services: {
                            rentnerproxy: {
                                volumes: [
                                    {
                                        type: 'bind',
                                        source: shimFile,
                                        target: '/usr/local/bin/rentnerproxy-production',
                                        read_only: true,
                                    },
                                    {
                                        type: 'bind',
                                        source: gateDirectory,
                                        target: '/smoke-startup-gate',
                                        read_only: true,
                                    },
                                ],
                            },
                        },
                    }),
                )
                const gatedCompose = [...compose, '--file', override]
                await command([...gatedCompose, 'up', '--force-recreate', '--detach'])
                id = await options.containerId(gatedCompose)
                await waitFor(async () => {
                    await command(
                        [
                            'docker',
                            'exec',
                            id,
                            'test',
                            '-e',
                            '/run/rentnerproxy/smoke-startup-gate',
                        ],
                        5_000,
                    )
                    return true
                }, 'dependency gate reached')
                await waitFor(
                    async () => (await probe()).every((sample) => sample.ok),
                    'persisted HTTP/HTTPS before dependency readiness',
                )
                await command(
                    [
                        'docker',
                        'exec',
                        id,
                        'bash',
                        '-c',
                        scenario === 'postgres'
                            ? '! gosu postgres pg_isready --host=/var/run/postgresql --username=postgres --dbname=postgres'
                            : '! gosu rentnerproxy /opt/rentnerproxy/valkey/bin/valkey-cli -h 127.0.0.1 ping',
                    ],
                    5_000,
                )
                const managementReady = await fetch(
                    'http://127.0.0.1:' + options.managementPort + '/health/ready',
                    {
                        signal: AbortSignal.timeout(1000),
                    },
                )
                    .then((response) => response.status === 200)
                    .catch(() => false)
                assert.equal(managementReady, false, 'web readiness preceded its dependencies')
                await options.assertSecurityReady(id)
                // Hold the gate through multiple external probes, independently of appliance health.
                await Bun.sleep(1000)
                assert.ok(
                    (await probe()).every((sample) => sample.ok),
                    'proxy traffic failed while dependency was gated',
                )
                await writeFile(gateFile, 'release\n')
            }
            id = await options.containerId([...compose])
            await options.waitForHealthy(id)
            await waitFor(
                async () => (await probe()).every((sample) => sample.ok),
                'traffic after startup',
            )
            assert.ok(successfulSamples >= 2, 'continuous external probes did not complete')
            assert.ok(
                performance.now() - started < 300_000,
                'continuous startup sampling budget exceeded',
            )
            verifiedRecoveryAt = performance.now()
            await waitFor(
                async () => recoveredSamples.every((count) => count > 0),
                'continuous HTTP/HTTPS recovery samples',
            )
            options.passed(
                `persisted HTTP/HTTPS ${scenario} startup; samples=${successfulSamples}/${unavailableSamples}; recovery gaps=${Math.round(largestGapMs[0]!)}ms/${Math.round(largestGapMs[1]!)}ms`,
            )
        } finally {
            if (gateFile) await writeFile(gateFile, 'release\n')
            sampling.abort()
            await sampler
        }
    }
    // Remove only the test entrypoint mounts, keeping the persisted appliance volume.
    await command([...compose, 'up', '--force-recreate', '--detach'])
    id = await options.containerId([...compose])
    await options.waitForHealthy(id)
    return id
}
