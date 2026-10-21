import type { HostTag } from '@/lib/HostTags/Types/host-tags.types.ts'
import type { RemoteClientTable } from '@/shared/Table/Types/table.types.ts'

export interface HostTableRemote extends RemoteClientTable {
    readonly domains: readonly string[]
    readonly tags: readonly HostTag[]
}
