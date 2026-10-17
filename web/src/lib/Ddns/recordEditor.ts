import { DDNS_AUTO_ZONE } from '@/config/ddns.config.ts'
import type { DdnsDraft, DdnsTarget, DdnsRecordEditorValues } from './Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import {
    addDdnsDomains,
    canonicalDdnsName,
    createDdnsTargetId,
    sameDdnsIdentity,
} from './targets.ts'

export function ddnsRecordEditorValues(target: DdnsTarget | null): DdnsRecordEditorValues {
    return {
        connectionId: target?.connectionId ?? '',
        zoneId: target?.zoneId ?? DDNS_AUTO_ZONE,
        recordType: target?.recordType ?? 'A',
        proxied: target?.proxied ?? true,
        enabled: target?.enabled ?? true,
        domains: [{ id: createDdnsTargetId(), value: target?.name ?? '' }],
    }
}
export function buildDdnsRecordDraft(
    draft: DdnsDraft,
    values: DdnsRecordEditorValues,
    connections: readonly DnsConnection[],
    editing: DdnsTarget | null,
): DdnsDraft {
    const names = values.domains
        .map((row) => row.value.trim())
        .filter(Boolean)
        .map(canonicalDdnsName)
    if (!names.length) throw new Error('admin.ddns.validation.domain')
    if (editing && (names.length !== 1 || values.recordType === 'both'))
        throw new Error('admin.ddns.errors.invalid_input')
    const connection = connections.find((item) => item.id === values.connectionId)
    // Existing metadata can be edited without granting access to new connection choices.
    if (
        !connection &&
        editing &&
        values.connectionId === editing.connectionId &&
        values.zoneId === editing.zoneId &&
        values.recordType === editing.recordType &&
        names[0] === editing.name
    )
        return {
            ...draft,
            targets: draft.targets.map((target) =>
                target.id === editing.id
                    ? { ...target, proxied: values.proxied, enabled: values.enabled }
                    : target,
            ),
        }
    if (!connection) throw new Error('admin.ddns.validation.zone')
    const retained = draft.targets.filter((target) => target.id !== editing?.id)
    const added = addDdnsDomains(
        {
            ...draft,
            ipv4: values.recordType !== 'AAAA',
            ipv6: values.recordType !== 'A',
            targets: retained,
        },
        connection,
        values.zoneId === DDNS_AUTO_ZONE ? '' : values.zoneId,
        names.join(','),
    )
    return {
        ...draft,
        targets: added.targets.map((target) => {
            if (retained.some((entry) => entry.id === target.id)) return target
            if (editing && sameDdnsIdentity(editing, Object.assign({}, target, { id: editing.id })))
                return Object.assign({}, editing, {
                    proxied: values.proxied,
                    enabled: values.enabled,
                })
            return Object.assign({}, target, { proxied: values.proxied, enabled: values.enabled })
        }),
    }
}
