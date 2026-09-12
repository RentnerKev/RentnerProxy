import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { canonicalIpNetwork } from '../../shared/Helpers/ipAccessRules'

function ipv6Hex(address: bigint): string {
    return address.toString(16).padStart(32, '0').match(/.{4}/gu)!.join(':')
}

function dotted(value: bigint): string {
    return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.')
}

describe('IP network normalization against independent references', () => {
    test('matches integer subnet arithmetic for IPv4', () => {
        fc.assert(
            fc.property(
                fc.bigInt({ min: 0n, max: (1n << 32n) - 1n }),
                fc.integer({ min: 0, max: 32 }),
                (address, prefix) => {
                    const hostBits = BigInt(32 - prefix)
                    const network = (address >> hostBits) << hostBits
                    expect(canonicalIpNetwork(dotted(address) + '/' + prefix)).toBe(
                        dotted(network) + '/' + prefix,
                    )
                },
            ),
            { numRuns: 250 },
        )
    })

    test('matches integer subnet arithmetic and URL IPv6 canonicalization', () => {
        fc.assert(
            fc.property(
                fc
                    .bigInt({ min: 0n, max: (1n << 128n) - 1n })
                    .filter((address) => address >> 32n !== 65535n),
                fc.integer({ min: 0, max: 128 }),
                (address, prefix) => {
                    const hostBits = BigInt(128 - prefix)
                    const network = (address >> hostBits) << hostBits
                    const reference = new URL('http://[' + ipv6Hex(network) + ']').hostname.slice(
                        1,
                        -1,
                    )
                    expect(canonicalIpNetwork(ipv6Hex(address) + '/' + prefix)).toBe(
                        reference + '/' + prefix,
                    )
                },
            ),
            { numRuns: 250 },
        )
    })
})
