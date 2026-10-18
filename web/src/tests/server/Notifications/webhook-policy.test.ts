import { describe, expect, test } from 'bun:test'
import {
    isWebhookAddressAllowed,
    parseWebhookDestination,
} from '@/server/Notifications/webhook-policy.ts'
import type { WebhookDestination } from '@/server/Notifications/Types/transport.types.ts'

const destination: WebhookDestination = {
    kind: 'webhook',
    url: 'https://receiver.example/path',
    authorizationToken: null,
    allowedPrivateCidrs: [],
}

describe('notification webhook address policy', () => {
    test('accepts public IPv4/IPv6 and denies special and transitional ranges', () => {
        for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
            expect(isWebhookAddressAllowed(address, destination)).toBe(true)
        for (const address of [
            '0.0.0.0',
            '10.0.0.1',
            '127.0.0.1',
            '169.254.169.254',
            '100.100.100.200',
            '192.0.2.1',
            '198.18.0.1',
            '224.0.0.1',
            '255.255.255.255',
            '::',
            '::1',
            '::ffff:8.8.8.8',
            '64:ff9b::808:808',
            '2002:808:808::1',
            '2001:db8::1',
            'fe80::1',
            'ff02::1',
            'fd00::1',
        ])
            expect(isWebhookAddressAllowed(address, destination)).toBe(false)
    })
    test('private CIDRs allow only their actual private subnet, including HTTP', () => {
        const local = {
            ...destination,
            url: 'http://receiver.example',
            allowedPrivateCidrs: ['10.2.0.0/16', 'fd12::/32', '127.0.0.1/32', '::1/128'],
        }
        for (const address of ['10.2.3.4', 'fd12::1', '127.0.0.1', '::1'])
            expect(isWebhookAddressAllowed(address, local)).toBe(true)
        for (const address of [
            '10.3.3.4',
            '8.8.8.8',
            '127.0.0.2',
            '169.254.169.254',
            '::ffff:127.0.0.1',
        ])
            expect(isWebhookAddressAllowed(address, local)).toBe(false)
        for (const cidr of [
            '0.0.0.0/0',
            '10.0.0.0/7',
            '127.0.0.0/8',
            '::/0',
            '169.254.0.0/16',
            'fc00::/6',
        ])
            expect(() =>
                parseWebhookDestination({ ...local, allowedPrivateCidrs: [cidr] }),
            ).toThrow('destination_blocked')
    })
    test('cloud metadata and platform endpoints stay denied even inside allowed private networks', () => {
        const local = { ...destination, allowedPrivateCidrs: ['fd00::/8'] }
        expect(isWebhookAddressAllowed('fd00::1234', local)).toBe(true)
        for (const address of ['fd00:ec2::254', '168.63.129.16']) {
            expect(isWebhookAddressAllowed(address, destination)).toBe(false)
            expect(isWebhookAddressAllowed(address, local)).toBe(false)
            expect(() =>
                parseWebhookDestination({
                    ...local,
                    url: `https://${address.includes(':') ? `[${address}]` : address}/`,
                }),
            ).toThrow('destination_blocked')
        }
        expect(
            isWebhookAddressAllowed('fd00:ec2::254', {
                ...destination,
                allowedPrivateCidrs: ['fd00:ec2::254/128'],
            }),
        ).toBe(false)
    })
    test('mapped and compatible IPv6 CIDRs never grant private or loopback access', () => {
        for (const cidr of [
            '::ffff:10.0.0.0/7',
            '::ffff:10.0.0.0/104',
            '::ffff:192.168.0.0/112',
            '::10.0.0.0/7',
            '::10.0.0.0/104',
            '::ffff:127.0.0.1/128',
            '::127.0.0.1/128',
        ]) {
            const invalid = { ...destination, allowedPrivateCidrs: [cidr] }
            expect(() => parseWebhookDestination(invalid)).toThrow('destination_blocked')
            for (const address of ['127.0.0.1', '::1', '10.1.2.3', '192.168.1.1', '172.16.0.1']) {
                expect(() => isWebhookAddressAllowed(address, invalid)).toThrow(
                    'destination_blocked',
                )
            }
        }
        const ula = { ...destination, allowedPrivateCidrs: ['fd12::/32'] }
        expect(isWebhookAddressAllowed('fd12::1', ula)).toBe(true)
        for (const address of ['127.0.0.1', '::1', '10.1.2.3'])
            expect(isWebhookAddressAllowed(address, ula)).toBe(false)
    })
    test('URL normalization blocks obfuscated private IPs and unsafe URL features', () => {
        for (const url of [
            'http://receiver.example',
            'https://2130706433',
            'https://0x7f000001',
            'https://0177.0.0.1',
            'https://[::ffff:127.0.0.1]',
            'https://user:pass@receiver.example',
            'https://receiver.example/#secret',
            'file:///tmp/a',
            'https://receiver.example/\r\nx',
        ])
            expect(() => parseWebhookDestination({ ...destination, url })).toThrow(
                'destination_blocked',
            )
    })
})
