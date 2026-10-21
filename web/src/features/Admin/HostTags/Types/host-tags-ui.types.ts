import type { HostKind, HostTag } from '@/lib/HostTags/Types/host-tags.types.ts'

export interface HostTagSelectProps {
    readonly kind: HostKind
    readonly value: readonly string[]
    readonly onChange: (ids: string[]) => void
    readonly disabled?: boolean
}
export interface HostTagsCellProps {
    readonly kind: HostKind
    readonly hostId: string
    readonly hostLabel: string
    readonly tags: readonly HostTag[] | undefined
    readonly canManage: boolean
}
