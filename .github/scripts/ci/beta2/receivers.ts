import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { z } from 'zod'
import type {
    Beta2Receivers,
    Beta2ReceiverCounters,
    Beta2ReceiverOptions,
    Beta2SmtpState,
} from './Types/receivers.types.ts'

const providerToken = 'beta2-fixture-provider-token'
const webhookToken = 'beta2-fixture-webhook-token'
const zoneId = 'a'.repeat(32)
const recordId = 'b'.repeat(32)
const name = 'app.beta2.test'
const ipv6 = '2606:4700:4700::1111'
const maxBody = 16_384
const eventFilter =
    '{"type":["container","network"],"event":["create","start","stop","die","destroy","rename","update","pause","unpause","connect","disconnect"]}'
const policy = z.strictObject({
    content: z.string().refine((value) => isIP(value) > 0),
    proxied: z.boolean(),
})
const creation = policy.extend({
    type: z.enum(['A', 'AAAA']),
    name: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+beta2\.test$/),
    ttl: z.literal(1),
    comment: z.string().min(1).max(512),
})
const webhookPayload = z.strictObject({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    incidentId: z.uuid(),
    type: z.enum(['incident', 'recovery', 'test']),
    category: z.enum(['certificate_renewal', 'ddns', 'proxy_configuration', 'host_availability']),
    severity: z.enum(['info', 'warning', 'error', 'critical']),
    resourceId: z.string().min(1).max(512),
    code: z.enum([
        'certificate_renewal_failed',
        'ddns_update_failed',
        'proxy_apply_failed',
        'operation_recovered',
        'notification_test',
    ]),
    occurredAt: z.iso.datetime(),
    startedAt: z.iso.datetime(),
    failures: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

function privateAddress(): string {
    for (const addresses of Object.values(networkInterfaces())) {
        for (const entry of addresses ?? []) {
            if (entry.internal || entry.family !== 'IPv4') continue
            const octets = entry.address.split('.').map(Number)
            if (
                octets[0] === 10 ||
                (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
                (octets[0] === 192 && octets[1] === 168)
            )
                return entry.address
        }
    }
    throw new Error(
        'Beta-2 fixture needs a private non-loopback IPv4 interface for Docker upstream traffic.',
    )
}

async function jsonBody(request: Request): Promise<unknown> {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return null
    // Bound the actual stream too; Content-Length is not a trustworthy limit.
    const reader = request.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        for (;;) {
            // oxlint-disable-next-line no-await-in-loop -- Read one bounded request stream sequentially.
            const part = await reader.read()
            if (part.done) break
            size += part.value.byteLength
            if (size > maxBody) {
                // oxlint-disable-next-line no-await-in-loop -- Cancel the oversized stream before returning.
                await reader.cancel()
                return null
            }
            chunks.push(part.value)
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
        return null
    } finally {
        reader.releaseLock()
    }
}

const unavailable = () => Response.json({ error: 'Fixture unavailable' }, { status: 503 })
const envelope = (result: unknown, perPage?: number) =>
    Response.json({
        success: true,
        errors: [],
        messages: [],
        result,
        ...(perPage
            ? {
                  result_info: {
                      page: 1,
                      per_page: perPage,
                      total_pages: 1,
                      count: Array.isArray(result) ? result.length : 1,
                      total_count: Array.isArray(result) ? result.length : 1,
                  },
              }
            : {}),
    })

const state = (): Beta2SmtpState => ({
    buffer: '',
    tls: false,
    sender: false,
    recipient: false,
    message: false,
    bytes: 0,
})
const reset = (session: Beta2SmtpState) => {
    session.sender = false
    session.recipient = false
    session.message = false
    session.bytes = 0
}

function smtpReceiver(
    tls: NonNullable<Beta2ReceiverOptions['smtpTls']>,
    counters: Beta2ReceiverCounters,
) {
    const connections = new Set<Bun.Socket<Beta2SmtpState>>()
    const retiredSessions = new WeakSet<Beta2SmtpState>()
    const reject = (socket: Bun.Socket<Beta2SmtpState>, response: string) => {
        counters.unexpectedRequests++
        counters.deniedMutations++
        socket.write(response + '\r\n')
    }
    const handler: Bun.SocketHandler<Beta2SmtpState> = {
        open(socket) {
            socket.data = state()
            if (connections.size >= 4) {
                socket.end('421 Fixture connection limit\r\n')
                return
            }
            connections.add(socket)
            socket.timeout(15)
            socket.write('220 beta2.invalid fixture ESMTP\r\n')
        },
        data(socket, bytes) {
            const session = socket.data
            if (retiredSessions.has(session)) return
            session.buffer += bytes.toString()
            if (session.buffer.length > 262_144) {
                reject(socket, '552 Fixture line too large')
                socket.end()
                return
            }
            let boundary: number
            while ((boundary = session.buffer.indexOf('\r\n')) !== -1) {
                const line = session.buffer.slice(0, boundary)
                session.buffer = session.buffer.slice(boundary + 2)
                if (session.message) {
                    if (line === '.') {
                        counters.smtpMessages++
                        reset(session)
                        socket.write('250 Fixture message accepted\r\n')
                        continue
                    }
                    session.bytes += Buffer.byteLength(line) + 2
                    if (session.bytes > 262_144) {
                        reject(socket, '552 Fixture message too large')
                        socket.end()
                        return
                    }
                    continue
                }
                if (/^(EHLO|HELO) [^\r\n]{1,253}$/i.test(line)) {
                    reset(session)
                    socket.write(
                        session.tls
                            ? '250-beta2.invalid\r\n250 8BITMIME\r\n'
                            : '250-beta2.invalid\r\n250 STARTTLS\r\n',
                    )
                } else if (line.toUpperCase() === 'STARTTLS' && !session.tls && !session.buffer) {
                    socket.write('220 Begin TLS\r\n')
                    // upgradeTLS retains the raw callbacks for ciphertext. Its old SMTP
                    // parser must stop before the new TLS socket receives plaintext.
                    retiredSessions.add(session)
                    connections.delete(socket)
                    const { open: _open, ...tlsHandler } = handler
                    const [, upgraded] = socket.upgradeTLS<Beta2SmtpState>({
                        tls,
                        data: { ...state(), tls: true },
                        socket: tlsHandler,
                    })
                    connections.add(upgraded)
                    return
                } else if (line.toUpperCase() === 'QUIT') {
                    socket.end('221 Bye\r\n')
                    return
                } else if (!session.tls) reject(socket, '530 STARTTLS required')
                else if (/^MAIL FROM:<[^<>\r\n]{1,254}>(?: SIZE=\d+)?$/i.test(line)) {
                    reset(session)
                    session.sender = true
                    socket.write('250 Sender accepted\r\n')
                } else if (
                    line.toUpperCase() === 'RCPT TO:<FIXTURE@BETA2.INVALID>' &&
                    session.sender &&
                    !session.recipient
                ) {
                    session.recipient = true
                    socket.write('250 Recipient accepted\r\n')
                } else if (line.toUpperCase() === 'DATA' && session.sender && session.recipient) {
                    session.message = true
                    socket.write('354 End with dot\r\n')
                } else if (line.toUpperCase() === 'RSET') {
                    reset(session)
                    socket.write('250 Reset\r\n')
                } else if (line.toUpperCase() === 'NOOP') socket.write('250 OK\r\n')
                else reject(socket, '550 Fixture command or recipient denied')
            }
        },
        close(socket) {
            connections.delete(socket)
        },
        timeout(socket) {
            socket.end()
        },
        error(socket) {
            connections.delete(socket)
            socket.end()
        },
    }
    const listener = Bun.listen<Beta2SmtpState>({ hostname: '127.0.0.1', port: 0, socket: handler })
    return {
        port: listener.port,
        stop() {
            for (const socket of connections) socket.end()
            connections.clear()
            listener.stop(true)
        },
    }
}

export function createBeta2Receivers(options: Beta2ReceiverOptions = {}): Beta2Receivers {
    const dockerAddress = privateAddress()
    const counters: Beta2ReceiverCounters = {
        ipv4Reads: 0,
        ipv6Reads: 0,
        providerReads: 0,
        providerWrites: 0,
        dockerReads: 0,
        webhooks: 0,
        smtpMessages: 0,
        unexpectedRequests: 0,
        deniedMutations: 0,
    }
    const streams = new Map<
        ReadableStreamDefaultController<Uint8Array>,
        ReturnType<typeof setTimeout>
    >()
    const closeStreams = () => {
        for (const [controller, timer] of streams) {
            clearTimeout(timer)
            controller.close()
        }
        streams.clear()
    }
    let address = '8.8.4.4'
    let generation = 0
    let containerId = 'a'.repeat(64)
    let providerUnavailable = false
    let dockerUnavailable = false
    let webhookUnavailable = false
    const records = [
        {
            id: recordId,
            name,
            type: 'A',
            content: '8.8.8.8',
            proxied: false,
            ttl: 300,
            comment: 'Preserve Beta-2 operator metadata',
            tags: ['fixture:beta2'],
        },
    ]
    const primary = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        fetch: () => Response.json({ backend: 'a' }),
    })
    const secondary = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        fetch: () => Response.json({ backend: 'b' }),
    })
    const unexpected = (mutation = false) => {
        counters.unexpectedRequests++
        if (mutation) counters.deniedMutations++
        return Response.json({ error: 'Unexpected fixture request' }, { status: 400 })
    }
    const receiver = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        // Docker event subscriptions rotate after 65 seconds without traffic.
        idleTimeout: 75,
        async fetch(request) {
            const url = new URL(request.url)
            const path = url.pathname
            const get = request.method === 'GET'
            if (path === '/v4' || path === '/v6') {
                if (
                    !get ||
                    request.headers.has('authorization') ||
                    request.headers.has('cookie') ||
                    url.search
                )
                    return unexpected(!get)
                if (path === '/v4') counters.ipv4Reads++
                else counters.ipv6Reads++
                return new Response('ip=' + (path === '/v4' ? address : ipv6) + '\n')
            }
            if (path.startsWith('/client/v4/')) {
                if (request.headers.get('authorization') !== `Bearer ${providerToken}`)
                    return unexpected(!get)
                if (get) counters.providerReads++
                else if (request.method === 'PATCH' || request.method === 'POST')
                    counters.providerWrites++
                if (
                    get &&
                    path === '/client/v4/zones' &&
                    url.searchParams.get('page') === '1' &&
                    url.searchParams.get('per_page') === '20' &&
                    [...url.searchParams.keys()].length === 2
                )
                    return providerUnavailable
                        ? unavailable()
                        : envelope(
                              [
                                  {
                                      id: zoneId,
                                      name: 'beta2.test',
                                      status: 'active',
                                      account: { id: 'fixture-account' },
                                      name_servers: ['fixture.beta2.test'],
                                  },
                              ],
                              20,
                          )
                const base = `/client/v4/zones/${zoneId}/dns_records`
                if (
                    get &&
                    path === base &&
                    url.searchParams.get('page') === '1' &&
                    url.searchParams.get('per_page') === '100' &&
                    [...url.searchParams.keys()].length === 3
                ) {
                    const owner = url.searchParams.get('name')
                    if (
                        !owner ||
                        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+beta2\.test$/.test(owner)
                    )
                        return unexpected()
                    if (providerUnavailable) return unavailable()
                    return envelope(
                        records.filter((record) => record.name === owner),
                        100,
                    )
                }
                if (request.method === 'PATCH' && path.startsWith(base + '/') && !url.search) {
                    const record = records.find((entry) => path === base + '/' + entry.id)
                    const parsed = policy.safeParse(await jsonBody(request))
                    if (
                        !record ||
                        !parsed.success ||
                        isIP(parsed.data.content) !== (record.type === 'A' ? 4 : 6)
                    )
                        return unexpected(true)
                    if (providerUnavailable) return unavailable()
                    Object.assign(record, parsed.data)
                    return envelope(record)
                }
                if (request.method === 'POST' && path === base && !url.search) {
                    const parsed = creation.safeParse(await jsonBody(request))
                    if (
                        !parsed.success ||
                        records.length >= 100 ||
                        records.some(
                            (record) =>
                                record.name === parsed.data.name &&
                                record.type === parsed.data.type,
                        ) ||
                        isIP(parsed.data.content) !== (parsed.data.type === 'A' ? 4 : 6)
                    )
                        return unexpected(true)
                    if (providerUnavailable) return unavailable()
                    const record = {
                        ...parsed.data,
                        id: (records.length + 1).toString(16).padStart(32, '0'),
                        tags: [],
                    }
                    records.push(record)
                    return envelope(record)
                }
                return unexpected(!get)
            }
            if (path === '/version' || /^\/v[0-9]+\.[0-9]+\//.test(path)) {
                if (!get) return unexpected(true)
                counters.dockerReads++
                if (dockerUnavailable) return unavailable()
                if (path === '/v1.47/events') {
                    if (
                        !/^\d{1,12}$/.test(url.searchParams.get('since') ?? '') ||
                        url.searchParams.get('filters') !== eventFilter ||
                        [...url.searchParams.keys()].length !== 2 ||
                        streams.size >= 4
                    )
                        return unexpected()
                    let current: ReadableStreamDefaultController<Uint8Array>
                    const stream = new ReadableStream<Uint8Array>({
                        start(controller) {
                            current = controller
                            // Flush response headers immediately; an empty Docker event line is ignored.
                            controller.enqueue(new TextEncoder().encode('\n'))
                            const timer = setTimeout(() => {
                                streams.delete(controller)
                                controller.close()
                            }, 65_000)
                            streams.set(controller, timer)
                        },
                        cancel() {
                            const timer = streams.get(current)
                            if (timer) clearTimeout(timer)
                            streams.delete(current)
                        },
                    })
                    return new Response(stream, { headers: { 'content-type': 'application/json' } })
                }
                if ((path === '/version' || path === '/v1.47/version') && !url.search)
                    return Response.json({
                        ApiVersion: '1.47',
                        MinAPIVersion: '1.24',
                        Version: '27.0.0',
                    })
                const id = containerId
                const port = generation % 2 === 1 ? secondary.port! : primary.port!
                const labels = {
                    'rentnerproxy.enable': 'true',
                    'rentnerproxy.id': 'beta2-fixture-app',
                    'rentnerproxy.domains': 'discovered.beta2.test',
                    'rentnerproxy.port': String(port),
                    'rentnerproxy.protocol': 'http',
                    'rentnerproxy.network': 'beta2-fixture',
                }
                if (
                    path === '/v1.47/containers/json' &&
                    url.searchParams.get('all') === '1' &&
                    url.searchParams.get('filters') === '{"label":["rentnerproxy.enable=true"]}' &&
                    [...url.searchParams.keys()].length === 2
                )
                    return Response.json([{ Id: id, Labels: labels }])
                if (path === `/v1.47/containers/${id}/json` && !url.search)
                    return Response.json({
                        Id: id,
                        Name: '/beta2-fixture-app',
                        Config: { Labels: labels, ExposedPorts: { [`${port}/tcp`]: {} } },
                        State: { Running: true, Paused: false, Restarting: false },
                        HostConfig: { NetworkMode: 'beta2-fixture' },
                        NetworkSettings: {
                            Networks: {
                                'beta2-fixture': {
                                    IPAddress: dockerAddress,
                                    GlobalIPv6Address: '',
                                },
                            },
                        },
                    })
                if (/^\/v1\.47\/containers\/[a-f0-9]{64}\/json$/.test(path) && !url.search)
                    return Response.json({ message: 'No such container' }, { status: 404 })
                return unexpected()
            }
            if (path === '/webhook') {
                if (
                    request.method !== 'POST' ||
                    url.search ||
                    request.headers.get('authorization') !== `Bearer ${webhookToken}`
                )
                    return unexpected(true)
                const parsed = webhookPayload.safeParse(await jsonBody(request))
                if (
                    !parsed.success ||
                    request.headers.get('idempotency-key') !== parsed.data.id ||
                    request.headers.get('x-rentnerproxy-event-id') !== parsed.data.id
                )
                    return unexpected(true)
                counters.webhooks++
                if (webhookUnavailable) return unavailable()
                return new Response(null, { status: 204 })
            }
            return unexpected(!get)
        },
    })
    const smtp = options.smtpTls ? smtpReceiver(options.smtpTls, counters) : null
    const url = `http://127.0.0.1:${receiver.port}`
    return {
        url,
        providerUrl: url + '/client/v4/',
        ipv4Url: url + '/v4',
        ipv6Url: url + '/v6',
        smtpPort: smtp?.port ?? null,
        primaryPort: primary.port!,
        secondaryPort: secondary.port!,
        dockerAddress,
        counters,
        setAddress(v4) {
            if (isIP(v4) !== 4) throw new Error('Expected a synthetic IPv4 address')
            address = v4
        },
        recreateContainer() {
            const previousId = containerId
            generation++
            containerId =
                generation === 1 ? 'c'.repeat(64) : generation.toString(16).padStart(64, '0')
            const encoder = new TextEncoder()
            const events = [
                ['destroy', previousId],
                ['create', containerId],
                ['start', containerId],
            ]
                .map(
                    ([action, id]) =>
                        JSON.stringify({
                            Type: 'container',
                            Action: action,
                            Actor: { ID: id },
                            timeNano: Date.now() * 1_000_000,
                        }) + '\n',
                )
                .join('')
            for (const controller of streams.keys()) controller.enqueue(encoder.encode(events))
        },
        setProviderUnavailable(value) {
            providerUnavailable = value
        },
        setDockerUnavailable(value) {
            dockerUnavailable = value
            if (value) closeStreams()
        },
        setWebhookUnavailable(value) {
            webhookUnavailable = value
        },
        async stop() {
            closeStreams()
            smtp?.stop()
            await Promise.all([receiver.stop(true), primary.stop(true), secondary.stop(true)])
        },
    }
}
