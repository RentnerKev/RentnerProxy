import { createSocket } from 'node:dgram'

interface TxtRecord {
    readonly id: string
    readonly type: 'TXT'
    readonly name: string
    readonly content: string
    readonly comment?: string
}

/** Minimal authoritative responder for the isolated certificate smoke, never production DNS. */
export function dnsFixtureResponse(
    query: Buffer,
    records: readonly TxtRecord[],
    addresses: ReadonlyMap<string, string>,
): Buffer | null {
    if (query.length < 17 || query.readUInt16BE(4) !== 1 || (query[2]! & 0x80) !== 0) return null
    const labels: string[] = []
    let offset = 12
    while (offset < query.length && query[offset] !== 0) {
        const length = query[offset++]!
        if (length > 63 || offset + length >= query.length) return null
        labels.push(
            query
                .subarray(offset, offset + length)
                .toString('ascii')
                .toLowerCase(),
        )
        offset += length
    }
    offset += 1
    if (offset + 4 > query.length) return null
    const type = query.readUInt16BE(offset)
    const dnsClass = query.readUInt16BE(offset + 2)
    const name = labels.join('.')
    const values: Buffer[] = []
    if (dnsClass === 1 && type === 16) {
        for (const record of records.filter((entry) => entry.name === name)) {
            const text = Buffer.from(record.content)
            if (text.length <= 255) values.push(Buffer.concat([Buffer.from([text.length]), text]))
        }
    } else if (dnsClass === 1 && type === 1) {
        const address = addresses.get(name)
        if (address) values.push(Buffer.from(address.split('.').map(Number)))
    }
    const header = Buffer.alloc(12)
    header.writeUInt16BE(query.readUInt16BE(0), 0)
    header.writeUInt16BE(0x8400 | (query.readUInt16BE(2) & 0x0100), 2)
    header.writeUInt16BE(1, 4)
    header.writeUInt16BE(values.length, 6)
    return Buffer.concat([
        header,
        query.subarray(12, offset + 4),
        ...values.map((value) => {
            const answer = Buffer.alloc(12)
            answer.writeUInt16BE(0xc00c, 0)
            answer.writeUInt16BE(type, 2)
            answer.writeUInt16BE(1, 4)
            answer.writeUInt32BE(1, 6)
            answer.writeUInt16BE(value.length, 10)
            return Buffer.concat([answer, value])
        }),
    ])
}

export async function startCertificateDnsFixture(apiToken: string) {
    const zoneId = 'a'.repeat(32)
    const records: TxtRecord[] = []
    const addresses = new Map<string, string>()
    const dns = createSocket('udp4')
    dns.on('message', (query, remote) => {
        const response = dnsFixtureResponse(query, records, addresses)
        if (response) dns.send(response, remote.port, remote.address)
    })
    await new Promise<void>((resolve, reject) => {
        dns.once('error', reject)
        dns.bind(0, '0.0.0.0', () => {
            dns.removeListener('error', reject)
            resolve()
        })
    })
    let nextId = 1
    let failCleanup = false
    let maxSimultaneousTxt = 0
    const api = Bun.serve({
        hostname: '0.0.0.0',
        port: 0,
        async fetch(request) {
            if (request.headers.get('authorization') !== `Bearer ${apiToken}`)
                return Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 })
            const url = new URL(request.url)
            const path = url.pathname.replace(/^\/client\/v4/u, '')
            const prefix = `/zones/${zoneId}`
            if (path === prefix && request.method === 'GET')
                return Response.json({ success: true, result: { id: zoneId, name: 'example.com' } })
            if (path === `${prefix}/dns_records` && request.method === 'GET') {
                const result = records.filter((record) =>
                    ['name', 'content', 'type', 'comment'].every((key) => {
                        const filter = url.searchParams.get(key)
                        return !filter || record[key as keyof TxtRecord] === filter
                    }),
                )
                return Response.json({
                    success: true,
                    result,
                    result_info: { page: 1, total_pages: 1, total_count: result.length },
                })
            }
            if (path === `${prefix}/dns_records` && request.method === 'POST') {
                const input = (await request.json()) as Omit<TxtRecord, 'id'>
                if (input.type !== 'TXT' || !input.name.endsWith('.example.com'))
                    return Response.json({ success: false }, { status: 400 })
                const record: TxtRecord = {
                    ...input,
                    id: (nextId++).toString(16).padStart(32, '0'),
                }
                records.push(record)
                maxSimultaneousTxt = Math.max(
                    maxSimultaneousTxt,
                    records.filter((entry) => entry.name === record.name).length,
                )
                return Response.json({ success: true, result: record })
            }
            if (path.startsWith(`${prefix}/dns_records/`) && request.method === 'DELETE') {
                if (failCleanup) return Response.json({ success: false }, { status: 503 })
                const id = path.slice(`${prefix}/dns_records/`.length)
                const index = records.findIndex((record) => record.id === id)
                if (index >= 0) records.splice(index, 1)
                return Response.json({ success: true, result: { id } })
            }
            return Response.json({ success: false }, { status: 404 })
        },
    })
    return {
        zoneId,
        apiPort: api.port!,
        dnsPort: dns.address().port,
        records,
        addresses,
        get maxSimultaneousTxt() {
            return maxSimultaneousTxt
        },
        set failCleanup(value: boolean) {
            failCleanup = value
        },
        stop() {
            api.stop(true)
            dns.close()
        },
    }
}
