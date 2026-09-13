import { describe, expect, test } from 'bun:test'
import { clientCountryCode } from '../server/Admin/ProxyAccessLogs/client-country'

describe('local client country lookup', () => {
    test('resolves public IPv4 and IPv6 addresses', () => {
        expect(clientCountryCode('8.8.8.8')).toBe('US')
        expect(clientCountryCode('2001:4860:4860::8888')).toBe('US')
    })

    test('does not invent countries for private, reserved, or malformed addresses', () => {
        for (const ip of [
            '127.0.0.1',
            '10.0.0.1',
            '192.168.1.1',
            '::1',
            'fd00::1',
            '192.0.2.1',
            '',
            'example.com',
            '8.8.8.8:443',
        ]) {
            expect(clientCountryCode(ip)).toBeNull()
        }
    })
})
