import { z } from 'zod'

import { MAX_ACCESS_POLICY_IP_RULES } from '../../config/access-policies.config'

export const ACCESS_POLICY_IP_RULE_ACTIONS = ['allow', 'deny'] as const
export type AccessPolicyIpRuleAction = (typeof ACCESS_POLICY_IP_RULE_ACTIONS)[number]

interface ParsedNetwork {
    readonly bytes: number[]
    readonly bits: 32 | 128
    readonly prefix: number
}

function parsePrefix(value: string, max: number): number | null {
    if (!/^[0-9]{1,3}$/u.test(value)) return null
    const prefix = Number(value)
    return Number.isInteger(prefix) && prefix >= 0 && prefix <= max ? prefix : null
}

function parseIpv4(value: string): ParsedNetwork | null {
    const parts = value.split('.')
    if (parts.length !== 4 || !parts.every((part) => /^(?:0|[1-9][0-9]{0,2})$/u.test(part))) {
        return null
    }
    const bytes = parts.map(Number)
    if (bytes.some((part) => part > 255)) return null
    return { bytes, bits: 32, prefix: 32 }
}

function parseIpv6(value: string): number[] | null {
    if (value.includes('%') || !value.includes(':')) return null
    if (value.includes('.')) {
        const separator = value.lastIndexOf(':')
        if (separator < 0) return null
        const ipv4 = parseIpv4(value.slice(separator + 1))
        if (!ipv4) return null
        const high = (ipv4.bytes[0]! << 8) | ipv4.bytes[1]!
        const low = (ipv4.bytes[2]! << 8) | ipv4.bytes[3]!
        value = `${value.slice(0, separator + 1)}${high.toString(16)}:${low.toString(16)}`
    }
    if ((value.match(/::/gu) ?? []).length > 1) return null
    const compressed = value.includes('::')
    const [left, right = ''] = compressed ? value.split('::') : [value, '']
    const leftGroups = left ? left.split(':') : []
    const rightGroups = right ? right.split(':') : []
    const groups = [...leftGroups, ...rightGroups]
    if (
        (groups.length === 0 && !compressed) ||
        groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group)) ||
        (!compressed && groups.length !== 8) ||
        (compressed && groups.length >= 8)
    ) {
        return null
    }
    const values = groups.map((group) => Number.parseInt(group, 16))
    const fill = compressed ? Array.from({ length: 8 - values.length }, () => 0) : []
    const parsed = compressed
        ? [
              ...leftGroups.map((group) => Number.parseInt(group, 16)),
              ...fill,
              ...rightGroups.map((group) => Number.parseInt(group, 16)),
          ]
        : values
    if (parsed.length !== 8) return null
    // IPv4-mapped IPv6 addresses are deliberately excluded from this contract.
    if (parsed.slice(0, 5).every((group) => group === 0) && parsed[5] === 0xffff) return null
    return parsed
}

function parseNetwork(value: string): ParsedNetwork | null {
    const pieces = value.split('/')
    if (pieces.length > 2 || pieces[0] === '') return null
    const address = pieces[0]!
    if (address.includes(':')) {
        const groups = parseIpv6(address)
        if (!groups) return null
        const prefix = pieces.length === 2 ? parsePrefix(pieces[1]!, 128) : 128
        if (prefix === null) return null
        const bytes = groups.flatMap((group) => [group >> 8, group & 0xff])
        return { bytes, bits: 128, prefix }
    }
    const parsed = parseIpv4(address)
    if (!parsed) return null
    const prefix = pieces.length === 2 ? parsePrefix(pieces[1]!, 32) : 32
    return prefix === null ? null : { ...parsed, prefix }
}

function maskBytes(bytes: ReadonlyArray<number>, prefix: number): number[] {
    return bytes.map((value, index) => {
        const remaining = prefix - index * 8
        if (remaining >= 8) return value
        if (remaining <= 0) return 0
        return value & (0xff << (8 - remaining))
    })
}

function formatIpv4(bytes: ReadonlyArray<number>, prefix: number): string {
    return `${bytes.join('.')}/${prefix}`
}

function formatIpv6(bytes: ReadonlyArray<number>, prefix: number): string {
    const groups = Array.from(
        { length: 8 },
        (_, index) => (bytes[index * 2]! << 8) | bytes[index * 2 + 1]!,
    )
    let bestStart = -1
    let bestLength = 1
    for (let start = 0; start < groups.length; start += 1) {
        if (groups[start] !== 0) continue
        let end = start
        while (end < groups.length && groups[end] === 0) end += 1
        if (end - start > bestLength) {
            bestStart = start
            bestLength = end - start
        }
        start = end - 1
    }
    const formatted = groups.map((group) => group.toString(16))
    if (bestStart < 0) return `${formatted.join(':')}/${prefix}`
    const left = formatted.slice(0, bestStart).join(':')
    const right = formatted.slice(bestStart + bestLength).join(':')
    return `${left}::${right}/${prefix}`
}

export function canonicalIpNetwork(value: string): string | null {
    const parsed = parseNetwork(value)
    if (!parsed) return null
    const masked = maskBytes(parsed.bytes, parsed.prefix)
    return parsed.bits === 32
        ? formatIpv4(masked, parsed.prefix)
        : formatIpv6(masked, parsed.prefix)
}

function compareAscii(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

export function canonicalizeIpNetworks(values: ReadonlyArray<string>): Array<string> {
    return [...new Set(values)].toSorted(compareAscii)
}

export const accessPolicyIpNetworkSchema = z
    .string()
    .max(64)
    .transform((value, context) => {
        const canonical = canonicalIpNetwork(value)
        if (canonical === null) {
            context.addIssue({ code: 'custom', message: 'Invalid IP address or network.' })
            return z.NEVER
        }
        return canonical
    })

export const accessPolicyIpRulesInputSchema = z
    .strictObject({
        defaultAction: z.enum(ACCESS_POLICY_IP_RULE_ACTIONS),
        allow: z.array(accessPolicyIpNetworkSchema).max(MAX_ACCESS_POLICY_IP_RULES),
        deny: z.array(accessPolicyIpNetworkSchema).max(MAX_ACCESS_POLICY_IP_RULES),
    })
    .transform((rules) => ({
        defaultAction: rules.defaultAction,
        allow: canonicalizeIpNetworks(rules.allow),
        deny: canonicalizeIpNetworks(rules.deny),
    }))

export interface AccessPolicyIpRules {
    readonly defaultAction: AccessPolicyIpRuleAction
    readonly allow: ReadonlyArray<string>
    readonly deny: ReadonlyArray<string>
}
