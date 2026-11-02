import { describe, expect, test } from 'bun:test'
import { resolveOidcClientIp } from '@/server/Auth/Oidc/oidc-request-ip.server.ts'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'

function request(forwarded?: string): Request {
    return new Request('http://localhost/api/auth/oidc/callback', {
        headers: {
            ...(forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }),
            forwarded: 'for=198.51.100.90',
            'x-real-ip': '198.51.100.91',
        },
    })
}

describe('OIDC request client addresses', () => {
    test('ignores spoofed forwarding headers unless deployment trust is explicitly enabled', () => {
        expect(resolveOidcClientIp(request('198.51.100.8'), '203.0.113.7', false)).toBe(
            '203.0.113.7',
        )
    })

    test('separates observed clients behind the same explicitly trusted proxy', () => {
        expect(resolveOidcClientIp(request('198.51.100.8'), '127.0.0.1', true)).toBe('198.51.100.8')
        expect(resolveOidcClientIp(request('198.51.100.9'), '127.0.0.1', true)).toBe('198.51.100.9')
    })

    test('uses the nearest observed address rather than a spoofed chain prefix', () => {
        expect(resolveOidcClientIp(request('192.0.2.99, 198.51.100.8'), '127.0.0.1', true)).toBe(
            '198.51.100.8',
        )
    })

    test.each([undefined, '', 'garbage', '198.51.100.8:443', '198.51.100.8,', 'fe80::1%eth0'])(
        'falls back to the peer for missing or malformed forwarding: %j',
        (forwarded) => {
            expect(resolveOidcClientIp(request(forwarded), '127.0.0.1', true)).toBe('127.0.0.1')
        },
    )

    test.each([undefined, '', 'garbage', 'fe80::1%eth0'])(
        'never substitutes forwarding headers for an unavailable peer: %j',
        (peer) => {
            expect(resolveOidcClientIp(request('198.51.100.8'), peer, true)).toBe('unknown')
        },
    )

    test('canonicalizes equivalent IPv6 spellings to the same identifier', () => {
        expect(
            resolveOidcClientIp(request('2001:0DB8:0000:0000:0000:0000:0000:0008'), '::1', true),
        ).toBe(resolveOidcClientIp(request('2001:db8::8'), '::1', true))
    })

    test('rejects oversized forwarding headers before inspecting the address chain', () => {
        const header = '1'.repeat(OIDC_LIMITS.forwardedForHeaderBytes) + ', 198.51.100.8'
        expect(resolveOidcClientIp(request(header), '127.0.0.1', true)).toBe('127.0.0.1')
    })

    test('bounds encoded header bytes even when a non-ASCII prefix has fewer characters', () => {
        const header = 'ä'.repeat(OIDC_LIMITS.forwardedForHeaderBytes / 2) + ', 198.51.100.8'
        expect(header.length).toBeLessThan(OIDC_LIMITS.forwardedForHeaderBytes)
        expect(resolveOidcClientIp(request(header), '127.0.0.1', true)).toBe('127.0.0.1')
    })
})
