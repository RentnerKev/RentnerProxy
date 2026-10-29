// oxlint-disable no-await-in-loop -- Protocol tests admit clients and deliver fragmented frames in order.
import { describe, expect, test } from 'bun:test'
import { createConnection, type Socket } from 'node:net'
import { Resolver } from 'node:dns/promises'
import { once } from 'node:events'
import {
    dnsFixtureResponse,
    startCertificateDnsFixture,
} from '../../../../../../../scripts/smoke/certificates/dns-fixture.ts'

function query(name: string, type: number): Buffer {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(42, 0)
    header.writeUInt16BE(0x0100, 2)
    header.writeUInt16BE(1, 4)
    const question = Buffer.concat(
        name
            .split('.')
            .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    )
    const tail = Buffer.alloc(5)
    tail.writeUInt16BE(type, 1)
    tail.writeUInt16BE(1, 3)
    return Buffer.concat([header, question, tail])
}

describe('local certificate DNS fixture', () => {
    test('limits the number of simultaneously admitted TCP clients', async () => {
        const fixture = await startCertificateDnsFixture('fixture-token')
        const sockets: Socket[] = []
        let deadline: ReturnType<typeof setTimeout> | undefined
        try {
            for (let index = 0; index < 32; index += 1) {
                const socket = createConnection({ host: '127.0.0.1', port: fixture.dnsPort })
                sockets.push(socket)
                socket.on('error', () => undefined)
                await once(socket, 'connect')
                socket.setTimeout(2_000, () => socket.destroy(new Error('fixture timed out')))
                const received = once(socket, 'data')
                const message = query('example.com', 16)
                const length = Buffer.alloc(2)
                length.writeUInt16BE(message.length)
                socket.write(Buffer.concat([length, message]))
                await received
            }
            const rejected = createConnection({ host: '127.0.0.1', port: fixture.dnsPort })
            sockets.push(rejected)
            rejected.on('error', () => undefined)
            await Promise.race([
                new Promise<void>((resolve) => rejected.once('close', () => resolve())),
                new Promise<never>((_, reject) => {
                    deadline = setTimeout(() => reject(new Error('connection cap missed')), 2_000)
                }),
            ])
            expect(rejected.destroyed).toBe(true)
        } finally {
            clearTimeout(deadline)
            for (const socket of sockets) socket.destroy()
            fixture.stop()
        }
    })

    test('accepts a maximally sized fragmented TCP frame and rejects a zero length frame', async () => {
        const fixture = await startCertificateDnsFixture('fixture-token')
        const socket = createConnection({ host: '127.0.0.1', port: fixture.dnsPort })
        socket.on('error', () => undefined)
        try {
            await once(socket, 'connect')
            socket.setTimeout(2_000, () => socket.destroy(new Error('fixture timed out')))
            const frame = Buffer.alloc(65_537)
            frame.writeUInt16BE(65_535)
            query('example.com', 16).copy(frame, 2)
            const received = once(socket, 'data')
            for (let offset = 0; offset < frame.length; offset += 257) {
                socket.write(frame.subarray(offset, offset + 257))
                await new Promise<void>((resolve) => setImmediate(resolve))
            }
            const [response] = await received
            expect((response as Buffer).readUInt16BE(2)).toBe(42)
            const closed = once(socket, 'close')
            socket.write(Buffer.alloc(2))
            await closed
        } finally {
            socket.destroy()
            fixture.stop()
        }
    })

    test('expires an incomplete TCP frame even while bytes keep arriving', async () => {
        const fixture = await startCertificateDnsFixture('fixture-token')
        const socket = createConnection({ host: '127.0.0.1', port: fixture.dnsPort })
        let drip: ReturnType<typeof setInterval> | undefined
        let deadline: ReturnType<typeof setTimeout> | undefined
        socket.on('error', () => undefined)
        try {
            await once(socket, 'connect')
            const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
            socket.write(Buffer.from([255, 255]))
            drip = setInterval(() => socket.write(Buffer.from([0])), 50)
            await Promise.race([
                closed,
                new Promise<never>((_, reject) => {
                    deadline = setTimeout(() => reject(new Error('frame deadline missed')), 6_000)
                }),
            ])
            expect(socket.destroyed).toBe(true)
        } finally {
            clearInterval(drip)
            clearTimeout(deadline)
            socket.destroy()
            fixture.stop()
        }
    }, 8_000)

    test('resolves CNAME chains, terminal TXT, NS cuts and SOA through a real recursive client', async () => {
        const fixture = await startCertificateDnsFixture('fixture-token')
        const source = '_acme-challenge.customer.invalid'
        const middle = 'intermediate.example.com'
        const terminal = '_acme-challenge.customer.example.com'
        const nsOwner = '_acme-challenge.ns-customer.invalid'
        fixture.cnames.set(source, middle)
        fixture.cnames.set(middle, terminal)
        fixture.nameservers.set('example.com', ['ns.fixture.invalid'])
        fixture.zones.set('b'.repeat(32), nsOwner)
        fixture.nameservers.set(nsOwner, ['ns.fixture.invalid'])
        for (const name of [terminal, nsOwner]) {
            for (const content of ['foreign-TXT', 'apex-proof', 'wildcard-proof']) {
                fixture.records.push({ id: name + content, type: 'TXT', name, content })
            }
        }
        const resolver = new Resolver({ timeout: 1_000, tries: 1 })
        resolver.setServers(['127.0.0.1:' + fixture.dnsPort])
        try {
            expect(await resolver.resolveCname(source)).toEqual([middle])
            expect(await resolver.resolveTxt(source)).toEqual([
                ['foreign-TXT'],
                ['apex-proof'],
                ['wildcard-proof'],
            ])
            expect(await resolver.resolveNs('example.com')).toEqual(['ns.fixture.invalid'])
            expect(await resolver.resolveNs(nsOwner)).toEqual(['ns.fixture.invalid'])
            expect(await resolver.resolveTxt(nsOwner)).toEqual([
                ['foreign-TXT'],
                ['apex-proof'],
                ['wildcard-proof'],
            ])
            expect((await resolver.resolveSoa(nsOwner)).nsname).toBe('ns.fixture.invalid')
            const negative = dnsFixtureResponse(
                query(terminal, 6),
                fixture.records,
                fixture.addresses,
                fixture,
            )!
            expect(negative.readUInt16BE(6)).toBe(0)
            expect(negative.readUInt16BE(8)).toBe(1)
            const missing = dnsFixtureResponse(
                query('missing.example.com', 16),
                fixture.records,
                fixture.addresses,
                fixture,
            )!
            expect(missing.readUInt16BE(6)).toBe(0)
            expect(missing.readUInt16BE(8)).toBe(1)
        } finally {
            fixture.stop()
        }
    })

    test('lists provider zones and permits TXT at a delegated zone apex without modifying delegation', async () => {
        const fixture = await startCertificateDnsFixture('fixture-token')
        const zoneId = 'b'.repeat(32)
        const owner = '_acme-challenge.customer.invalid'
        fixture.zones.set(zoneId, owner)
        fixture.nameservers.set(owner, ['ns.fixture.invalid'])
        const headers = {
            authorization: 'Bearer fixture-token',
            'content-type': 'application/json',
        }
        const api = 'http://127.0.0.1:' + fixture.apiPort + '/client/v4'
        try {
            const zones = await (await fetch(api + '/zones', { headers })).json()
            expect(zones.result).toContainEqual({ id: zoneId, name: owner })
            const created = await (
                await fetch(api + '/zones/' + zoneId + '/dns_records', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ type: 'TXT', name: owner, content: 'owned-proof' }),
                })
            ).json()
            expect(created.success).toBe(true)
            expect(
                (
                    await fetch(api + '/zones/' + fixture.zoneId + '/dns_records', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ type: 'TXT', name: owner, content: 'out-of-zone' }),
                    })
                ).status,
            ).toBe(400)
            const otherZone = await (
                await fetch(api + '/zones/' + fixture.zoneId + '/dns_records', { headers })
            ).json()
            expect(otherZone.result).toEqual([])
            await fetch(api + '/zones/' + zoneId + '/dns_records/' + created.result.id, {
                method: 'DELETE',
                headers,
            })
            expect(fixture.records).toEqual([])
            expect(fixture.nameservers.get(owner)).toEqual(['ns.fixture.invalid'])
        } finally {
            fixture.stop()
        }
    })

    test('serves Pebble DNS over TCP with fragmented and coalesced query frames', async () => {
        const fixture = await startCertificateDnsFixture('fixture-token')
        fixture.addresses.set('acme.invalid', '172.20.0.2')
        for (const content of ['apex-proof', 'wildcard-proof']) {
            fixture.records.push({
                id: content,
                type: 'TXT',
                name: '_acme-challenge.example.com',
                content,
            })
        }
        try {
            const requests = Buffer.concat(
                [
                    query('acme.invalid', 1),
                    query('_acme-challenge.example.com', 16),
                    query('acme.invalid', 28),
                ].map((message) => {
                    const length = Buffer.alloc(2)
                    length.writeUInt16BE(message.length)
                    return Buffer.concat([length, message])
                }),
            )
            const responses = await new Promise<Buffer[]>((resolve, reject) => {
                const socket = createConnection({ host: '127.0.0.1', port: fixture.dnsPort })
                let pending = Buffer.alloc(0)
                const messages: Buffer[] = []
                let fragmentTimer: ReturnType<typeof setTimeout> | undefined
                socket.on('error', reject)
                socket.on('close', () => clearTimeout(fragmentTimer))
                socket.setTimeout(2_000, () =>
                    socket.destroy(new Error('DNS TCP fixture timed out')),
                )
                socket.on('connect', () => {
                    socket.write(requests.subarray(0, 1))
                    fragmentTimer = setTimeout(() => socket.write(requests.subarray(1)), 20)
                })
                socket.on('data', (chunk: Buffer) => {
                    pending = Buffer.concat([pending, chunk])
                    while (pending.length >= 2 && pending.length >= pending.readUInt16BE(0) + 2) {
                        const length = pending.readUInt16BE(0)
                        messages.push(Buffer.from(pending.subarray(2, length + 2)))
                        pending = pending.subarray(length + 2)
                    }
                    if (messages.length === 3) {
                        socket.destroy()
                        resolve(messages)
                    }
                })
            })
            expect([...responses[0]!.subarray(-4)]).toEqual([172, 20, 0, 2])
            expect(responses[1]!.readUInt16BE(6)).toBe(2)
            expect(responses[1]!.includes(Buffer.from('apex-proof'))).toBe(true)
            expect(responses[1]!.includes(Buffer.from('wildcard-proof'))).toBe(true)
            expect(responses[2]!.readUInt16BE(6)).toBe(0)
        } finally {
            fixture.stop()
        }
    })

    test('serves both apex and wildcard proofs at the same TXT owner', () => {
        const name = '_acme-challenge.example.com'
        const records = ['apex-proof', 'wildcard-proof'].map((content, id) => ({
            id: String(id),
            name,
            type: 'TXT' as const,
            content,
        }))
        const result = dnsFixtureResponse(query(name, 16), records, new Map())!
        expect(result.readUInt16BE(0)).toBe(42)
        expect(result.readUInt16BE(6)).toBe(2)
        expect(result.includes(Buffer.from('apex-proof'))).toBe(true)
        expect(result.includes(Buffer.from('wildcard-proof'))).toBe(true)
        expect(
            dnsFixtureResponse(query('other.example.com', 16), records, new Map())!.readUInt16BE(6),
        ).toBe(0)
    })

    test('only resolves explicitly mapped HTTP-01 names, with empty AAAA/CAA answers', () => {
        const addresses = new Map([['acme.invalid', '172.20.0.2']])
        const result = dnsFixtureResponse(query('acme.invalid', 1), [], addresses)!
        expect(result.readUInt16BE(6)).toBe(1)
        expect([...result.subarray(-4)]).toEqual([172, 20, 0, 2])
        for (const type of [1, 28, 257]) {
            expect(
                dnsFixtureResponse(query('failed.invalid', type), [], addresses)!.readUInt16BE(6),
            ).toBe(0)
        }
    })

    test('ignores truncated packets, compression loops and multi-question requests', () => {
        const valid = query('example.com', 16)
        for (let length = 0; length < valid.length; length += 1) {
            expect(dnsFixtureResponse(valid.subarray(0, length), [], new Map())).toBeNull()
        }
        const loop = Buffer.from(valid)
        loop[12] = 0xc0
        expect(dnsFixtureResponse(loop, [], new Map())).toBeNull()
        const multiple = Buffer.from(valid)
        multiple.writeUInt16BE(2, 4)
        expect(dnsFixtureResponse(multiple, [], new Map())).toBeNull()
    })
})
