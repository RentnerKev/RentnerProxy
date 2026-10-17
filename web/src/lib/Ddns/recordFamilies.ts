import { activeDdnsTarget } from './targets.ts'
import type { DdnsDraft } from './Types/ddns.types.ts'

export function withDdnsRecordFamilies(draft: DdnsDraft): DdnsDraft {
    return {
        ...draft,
        ipv4: draft.targets.some((target) => target.enabled && target.recordType === 'A'),
        ipv6: draft.targets.some((target) => target.enabled && target.recordType === 'AAAA'),
    }
}

export function editableDdnsRecordDraft(draft: DdnsDraft): DdnsDraft {
    // Preserve effective pauses from older configurations with global family switches.
    return withDdnsRecordFamilies({
        ...draft,
        targets: draft.targets.map((target) => ({
            ...target,
            enabled: activeDdnsTarget(draft, target),
        })),
    })
}
