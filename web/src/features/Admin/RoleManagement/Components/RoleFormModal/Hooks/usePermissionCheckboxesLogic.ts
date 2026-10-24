import { useId, useState } from 'react'

import {
    filterPermissionGroups,
    getAvailablePermissionGroups,
} from '@/lib/Admin/RoleManagement/permissionCheckboxes.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { PermissionCheckboxesProps } from '../../../Types/role-management-component-props.types.ts'
import type { PermissionCheckboxesLogicResult } from '../Types/permission-checkboxes.types.ts'

const handleSearchKeyDown: PermissionCheckboxesLogicResult['handler']['handleSearchKeyDown'] = (
    event,
) => {
    if (event.key === 'Enter') event.preventDefault()
}

export default function usePermissionCheckboxesLogic({
    availablePermissionKeys,
}: Pick<PermissionCheckboxesProps, 'availablePermissionKeys'>): PermissionCheckboxesLogicResult {
    const { t } = useTranslationStore()
    const [search, setSearch] = useState('')
    const searchId = useId()
    const permissionGroups = filterPermissionGroups(
        getAvailablePermissionGroups(availablePermissionKeys),
        search,
        t,
    )
    return {
        state: { permissionGroups, search, searchId },
        setter: { setSearch },
        handler: { handleSearchKeyDown },
    }
}
