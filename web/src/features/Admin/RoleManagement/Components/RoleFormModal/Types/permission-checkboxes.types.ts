import type { KeyboardEventHandler } from 'react'

import type { PermissionGroup } from '@/lib/Admin/RoleManagement/Types/permission-checkboxes.types.ts'

export interface PermissionCheckboxesLogicResult {
    readonly state: {
        readonly permissionGroups: readonly PermissionGroup[]
        readonly search: string
        readonly searchId: string
    }
    readonly setter: {
        readonly setSearch: (value: string) => void
    }
    readonly handler: {
        readonly handleSearchKeyDown: KeyboardEventHandler<HTMLInputElement>
    }
}
