import { MAX_DDNS_TARGETS } from '@/config/ddns.config.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type { DdnsBatch, DdnsDraft, DdnsTarget } from './Types/ddns.types.ts'
import { ddnsDraftSchema, ddnsNameSchema } from './validation.ts'

export function ddnsDraft(settings?: DdnsDraft): DdnsDraft {
    return settings
        ? {
              intervalSeconds: settings.intervalSeconds,
              updateOnStart: settings.updateOnStart,
              ipv4: settings.ipv4,
              ipv6: settings.ipv6,
              targets: settings.targets.map((target) => ({
                  ...target,
                  selection: { ...target.selection },
              })),
          }
        : { intervalSeconds: 300, updateOnStart: true, ipv4: true, ipv6: false, targets: [] }
}
export function activeDdnsTarget(draft: DdnsDraft, target: DdnsTarget): boolean {
    return target.enabled && (target.recordType === 'A' ? draft.ipv4 : draft.ipv6)
}
export function ddnsFingerprint(draft: DdnsDraft): string {
    return JSON.stringify(ddnsDraftSchema.parse(ddnsDraft(draft)))
}
export function sameDdnsIdentity(left: DdnsTarget, right: DdnsTarget): boolean {
    return (
        left.id === right.id &&
        left.connectionId === right.connectionId &&
        left.zoneId === right.zoneId &&
        left.name === right.name &&
        left.recordType === right.recordType
    )
}
export function canonicalDdnsName(input: string): string {
    const raw = input.trim().replace(/\.$/u, '').toLowerCase()
    const wildcard = raw.startsWith('*.')
    const base = wildcard ? raw.slice(2) : raw
    if (!base || /[\s/@:#?\\*]/u.test(base)) throw new Error('admin.ddns.validation.domain')
    let name: string
    try {
        name = `${wildcard ? '*.' : ''}${new URL(`https://${base}`).hostname}`
    } catch {
        throw new Error('admin.ddns.validation.domain')
    }
    if (!ddnsNameSchema.safeParse(name).success) throw new Error('admin.ddns.validation.domain')
    return name
}
export function createDdnsTargetId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    let time = BigInt(Date.now())
    for (let index = 5; index >= 0; index -= 1) {
        bytes[index] = Number(time & 255n)
        time >>= 8n
    }
    bytes[6] = (bytes[6]! & 15) | 0x70
    bytes[8] = (bytes[8]! & 63) | 0x80
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function addDdnsDomains(
    draft: DdnsDraft,
    connection: DnsConnection,
    zoneId: string,
    text: string,
    createId = createDdnsTargetId,
): DdnsDraft {
    if (text.length > 32_000 || (!draft.ipv4 && !draft.ipv6))
        throw new Error('admin.ddns.validation.families')
    const names = text
        .split(/[\s,;]+/u)
        .filter(Boolean)
        .map(canonicalDdnsName)
    if (!names.length || names.length > MAX_DDNS_TARGETS)
        throw new Error('admin.ddns.validation.targets')
    const targets = [...draft.targets]
    for (const name of names) {
        const base = name.startsWith('*.') ? name.slice(2) : name
        const zone = connection.zones
            .filter(
                (candidate) =>
                    (!zoneId || candidate.id === zoneId) &&
                    (base === candidate.name || base.endsWith(`.${candidate.name}`)),
            )
            .toSorted((a, b) => b.name.length - a.name.length)[0]
        if (!zone) throw new Error('admin.ddns.validation.zone')
        for (const recordType of [
            ...(draft.ipv4 ? ['A' as const] : []),
            ...(draft.ipv6 ? ['AAAA' as const] : []),
        ])
            targets.push({
                id: createId(),
                connectionId: connection.id,
                zoneId: zone.id,
                name,
                recordType,
                proxied: true,
                enabled: true,
                selection: { mode: 'inspect' },
            })
    }
    const parsed = ddnsDraftSchema.safeParse({ ...draft, targets })
    if (!parsed.success)
        throw new Error(parsed.error.issues[0]?.message ?? 'admin.ddns.validation.targets')
    return parsed.data
}
export function approveDdnsInspection(draft: DdnsDraft, batch: DdnsBatch): DdnsDraft {
    return {
        ...draft,
        targets: draft.targets.map((target) => {
            const result = batch.targets.find((entry) => entry.targetId === target.id)
            if (result?.status === 'adoption_required' && result.current)
                return { ...target, selection: { mode: 'adopt', recordId: result.current.id } }
            if (result?.status === 'creation_required')
                return { ...target, selection: { mode: 'create' } }
            return target
        }),
    }
}
export function readyDdnsPreview(draft: DdnsDraft, batch: DdnsBatch): boolean {
    return (
        batch.preview &&
        batch.targets.length === draft.targets.length &&
        draft.targets.every((target) => {
            const result = batch.targets.find((entry) => entry.targetId === target.id)
            return (
                !!result &&
                (!activeDdnsTarget(draft, target) ||
                    (target.selection.mode !== 'inspect' &&
                        ['unchanged', 'would_create', 'would_update'].includes(result.status) &&
                        !result.error))
            )
        })
    )
}
