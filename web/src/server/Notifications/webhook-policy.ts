import { BlockList, isIP } from 'node:net'
import type { WebhookDestination } from './Types/transport.types.ts'

function subnet(address: string, prefix: number): BlockList {
    const list = new BlockList()
    list.addSubnet(address, prefix, isIP(address) === 6 ? 'ipv6' : 'ipv4')
    return list
}

const privateRanges = [
    subnet('10.0.0.0', 8),
    subnet('172.16.0.0', 12),
    subnet('192.168.0.0', 16),
    subnet('fc00::', 7),
]
const publicV6 = subnet('2000::', 3)
const denied = [
    subnet('0.0.0.0', 8),
    subnet('100.64.0.0', 10),
    subnet('127.0.0.0', 8),
    subnet('169.254.0.0', 16),
    subnet('168.63.129.16', 32),
    subnet('192.0.0.0', 24),
    subnet('192.0.2.0', 24),
    subnet('192.88.99.0', 24),
    subnet('198.18.0.0', 15),
    subnet('198.51.100.0', 24),
    subnet('203.0.113.0', 24),
    subnet('224.0.0.0', 3),
    subnet('2001::', 23),
    subnet('2001:db8::', 32),
    subnet('2002::', 16),
    subnet('3fff::', 20),
    subnet('fd00:ec2::254', 128),
]

function contains(list: BlockList, address: string): boolean {
    return list.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
}

function allowedSubnets(cidrs: readonly string[]): BlockList[] {
    if (cidrs.length > 16) throw new Error('destination_blocked')
    return cidrs.map((cidr) => {
        const parts = cidr.split('/')
        const address = parts[0] ?? ''
        const prefix = Number(parts[1])
        const family = isIP(address)
        if (
            parts.length !== 2 ||
            !/^\d{1,3}$/.test(parts[1] ?? '') ||
            !family ||
            !Number.isInteger(prefix) ||
            prefix < 0 ||
            prefix > (family === 6 ? 128 : 32)
        )
            throw new Error('destination_blocked')
        if ((address === '127.0.0.1' && prefix === 32) || (address === '::1' && prefix === 128))
            return subnet(address, prefix)
        // A matching base address alone is insufficient: the entire requested subnet must be private.
        if (family === 6) {
            // BlockList intentionally matches mapped IPv4 against IPv4 subnets. CIDR
            // admission must instead establish a genuinely IPv6 ULA subnet first.
            if (prefix < 7 || !contains(privateRanges[3]!, address))
                throw new Error('destination_blocked')
        } else {
            const privateRange = privateRanges
                .slice(0, 3)
                .findIndex((range) => contains(range, address))
            const minimum = [8, 12, 16][privateRange]
            if (minimum === undefined || prefix < minimum) throw new Error('destination_blocked')
        }
        return subnet(address, prefix)
    })
}

export function parseWebhookDestination(destination: WebhookDestination): URL {
    if (
        destination.url.length > 2_048 ||
        /\s/u.test(destination.url) ||
        Array.from(destination.url).some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
    )
        throw new Error('destination_blocked')
    let url: URL
    try {
        url = new URL(destination.url)
    } catch {
        throw new Error('destination_blocked')
    }
    const authority = destination.url.split('://')[1]?.split(/[/?#]/)[0] ?? ''
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        !authority ||
        authority.includes('@') ||
        destination.url.includes('#') ||
        url.username ||
        url.password ||
        url.hash ||
        !url.hostname
    )
        throw new Error('destination_blocked')
    if (
        destination.authorizationToken !== null &&
        !/^[\x21-\x7e]{1,2048}$/.test(destination.authorizationToken)
    )
        throw new Error('destination_blocked')
    allowedSubnets(destination.allowedPrivateCidrs)
    const address = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(address) && !isWebhookAddressAllowed(address, destination))
        throw new Error('destination_blocked')
    if (url.protocol === 'http:' && destination.allowedPrivateCidrs.length === 0)
        throw new Error('destination_blocked')
    return url
}

export function isWebhookAddressAllowed(address: string, destination: WebhookDestination): boolean {
    const family = isIP(address)
    if (!family) return false
    const explicitlyAllowed = allowedSubnets(destination.allowedPrivateCidrs).some((range) =>
        contains(range, address),
    )
    if (address === '127.0.0.1' || address === '::1') return explicitlyAllowed
    // IPv4-mapped, compatible, NAT64 and other transitional IPv6 forms never qualify.
    if (family === 6 && !contains(publicV6, address) && !contains(privateRanges[3]!, address))
        return false
    if (denied.some((range) => contains(range, address))) return false
    if (privateRanges.some((range) => contains(range, address))) return explicitlyAllowed
    return /^https:/i.test(destination.url)
}
