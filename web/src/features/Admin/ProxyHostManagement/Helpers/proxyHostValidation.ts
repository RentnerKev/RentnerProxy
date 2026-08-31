import { z } from 'zod'

const dnsLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
const ipv4Schema = z.ipv4()
const forbiddenHostnameCharacters = /[\s\p{Cc}/:\\?#@%[\]]/u

export function normalizeProxyDomain(value: string): string | null {
    const input = value.trim()

    if (!input || input.length > 1_024 || forbiddenHostnameCharacters.test(input)) return null

    try {
        const hostname = new URL(`http://${input}`).hostname.toLowerCase().replace(/\.$/u, '')

        if (
            hostname.length > 253 ||
            !hostname.split('.').every((label) => dnsLabelPattern.test(label)) ||
            ipv4Schema.safeParse(hostname).success
        ) {
            return null
        }

        return hostname
    } catch {
        return null
    }
}

export function normalizeForwardHost(value: string): string | null {
    const input = value.trim()
    const address = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input

    if (address.includes(':')) {
        if (address.length > 45 || !/^[a-f\d:.]+$/iu.test(address)) return null

        try {
            return new URL(`http://[${address}]`).hostname.slice(1, -1)
        } catch {
            return null
        }
    }

    if (ipv4Schema.safeParse(input).success) return input

    return normalizeProxyDomain(input)
}
export function normalizeUpstreamTlsServerName(value: string): string | null {
    return normalizeProxyDomain(value)
}
