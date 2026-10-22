import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type {
    HostKind,
    HostListEntry,
    HostTagState,
    HostListQuery,
} from '@/lib/HostTags/Types/host-tags.types.ts'

export interface HostPageReaderDependencies<T extends HostListEntry, S extends T> {
    readonly kind: HostKind
    readonly permission: PermissionKey
    readonly authorize: (permission: PermissionKey) => Promise<{ readonly id: string }>
    readonly reauthorize: (
        transaction: AuthTransaction,
        actorId: string,
        permission: PermissionKey,
    ) => Promise<unknown>
    readonly transaction: <R>(run: (transaction: AuthTransaction) => Promise<R>) => Promise<R>
    readonly readTags: (transaction: AuthTransaction, kind: HostKind) => Promise<HostTagState>
    readonly readBasis: (transaction: AuthTransaction) => Promise<T[]>
    readonly readSummaries: (transaction: AuthTransaction, ids: readonly string[]) => Promise<S[]>
    readonly labels: (
        locale: HostListQuery['locale'],
    ) => Promise<{ enabled: string; disabled: string }>
}
