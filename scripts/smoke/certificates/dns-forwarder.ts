import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { connect, createServer, isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { CertificateSetupContext } from './Types/scenarios.types.ts'

const forwarderImage =
    'mirror.gcr.io/oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d'

export function manualDnsForwarderName(project: string): string {
    assert.match(project, /^rentnerproxy-certificate-smoke-[a-f0-9]{12}$/u)
    return project + '-manual-dns'
}

export async function refreshManualDnsForwarder(context: CertificateSetupContext): Promise<void> {
    assert.ok(context.dnsFixture)
    const name = manualDnsForwarderName(context.project)
    // Read the host-gateway mapping used by this exact runtime, not the sidecar's hosts file.
    const hosts = await context.command([
        'docker',
        'exec',
        context.runtimeContainer,
        'cat',
        '/etc/hosts',
    ])
    const gateway = hosts
        .split('\n')
        .find((line) => /\s+host\.docker\.internal(?:\s|$)/u.test(line))
        ?.trim()
        .split(/\s+/u)[0]
    assert.ok(gateway && isIP(gateway) === 4)
    await context.command(['docker', 'rm', '--force', name]).catch(() => undefined)
    await context.command(
        [
            'docker',
            'run',
            '--detach',
            '--name',
            name,
            '--label',
            'io.rentnerproxy.certificate-smoke=' + context.project,
            '--network',
            'container:' + context.runtimeContainer,
            '--read-only',
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges',
            '--volume',
            fileURLToPath(import.meta.url) + ':/fixture/dns-forwarder.ts:ro',
            '--entrypoint',
            'bun',
            forwarderImage,
            '--no-env-file',
            '/fixture/dns-forwarder.ts',
            gateway,
            String(context.dnsFixture.dnsPort),
        ],
        { timeoutMs: 60_000 },
    )
    await context.waitFor(
        async () =>
            (await context.command(['docker', 'logs', name])).includes(
                'manual DNS fixture forwarder ready',
            ),
        'loopback manual DNS fixture forwarder',
    )
}

async function runForwarder(): Promise<void> {
    const [gateway, portArgument] = process.argv.slice(2)
    const port = Number(portArgument)
    assert.ok(gateway && isIP(gateway) === 4)
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
    const target = gateway
    const listener = createSocket('udp4')
    let inFlight = 0
    listener.on('message', (query, remote) => {
        if (query.length < 12 || query.length > 65_535 || inFlight >= 256) return
        inFlight += 1
        // Wildcard-bound UDP fixtures may reply from another host interface on Linux.
        // TCP pins the upstream peer while preserving the loopback UDP client interface.
        const upstream = connect(port, target, () => {
            const length = Buffer.alloc(2)
            length.writeUInt16BE(query.length)
            upstream.write(Buffer.concat([length, query]))
        })
        let pending = Buffer.alloc(0)
        const timeout = setTimeout(() => upstream.destroy(), 4_000)
        upstream.once('close', () => {
            clearTimeout(timeout)
            inFlight -= 1
        })
        upstream.once('error', () => upstream.destroy())
        upstream.on('data', (chunk: Buffer) => {
            if (pending.length + chunk.length > 65_537) {
                upstream.destroy()
                return
            }
            pending = Buffer.concat([pending, chunk])
            if (pending.length < 2) return
            const length = pending.readUInt16BE(0)
            if (length < 12) {
                upstream.destroy()
                return
            }
            if (pending.length < length + 2) return
            const answer = pending.subarray(2, length + 2)
            if (answer.readUInt16BE(0) === query.readUInt16BE(0) && (answer[2]! & 0x80) !== 0) {
                listener.send(answer, remote.port, remote.address)
            }
            upstream.destroy()
        })
    })
    const tcp = createServer((client) => {
        const upstream = connect(port, target)
        client.setTimeout(5_000, () => client.destroy())
        upstream.setTimeout(5_000, () => upstream.destroy())
        client.on('error', () => upstream.destroy())
        upstream.on('error', () => client.destroy())
        client.on('close', () => upstream.destroy())
        upstream.on('close', () => client.destroy())
        client.pipe(upstream).pipe(client)
    })
    await Promise.all([
        new Promise<void>((resolve, reject) => {
            listener.once('error', reject)
            listener.bind(15353, '127.0.0.1', () => resolve())
        }),
        new Promise<void>((resolve, reject) => {
            tcp.once('error', reject)
            tcp.listen(15353, '127.0.0.1', () => resolve())
        }),
    ])
    console.log('manual DNS fixture forwarder ready')
}

if (import.meta.main) await runForwarder()
