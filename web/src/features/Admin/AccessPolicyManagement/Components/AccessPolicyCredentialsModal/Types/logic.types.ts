import type { BasicAuthAccount } from '../../../Types/basic-auth.types.ts'

export interface BasicAuthAccountsLogicResult {
    readonly state: {
        readonly accountLimitReached: boolean
        readonly accounts: BasicAuthAccount[]
        readonly deleteTarget: BasicAuthAccount | null
        readonly formAccount: BasicAuthAccount | null
        readonly isDeleting: boolean
        readonly isError: boolean
        readonly isLoading: boolean
        readonly isMutating: boolean
        readonly showForm: boolean
    }
    readonly handler: {
        readonly confirmDelete: () => Promise<void>
        readonly handleFormSuccess: () => Promise<void>
        readonly handleOpenChange: (open: boolean) => void
        readonly openCreate: () => void
        readonly openDelete: (account: BasicAuthAccount) => void
        readonly openEdit: (account: BasicAuthAccount) => void
        readonly retry: () => void
        readonly setDeleteOpen: (open: boolean) => void
        readonly setFormOpen: (open: boolean) => void
    }
}
