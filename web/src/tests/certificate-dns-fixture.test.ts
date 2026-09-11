import { describe, expect, test } from 'bun:test'
import { dnsFixtureResponse } from '../../../scripts/certificate-dns-fixture'

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
