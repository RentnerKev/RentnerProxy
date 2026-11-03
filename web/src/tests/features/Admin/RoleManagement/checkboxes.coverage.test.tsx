import { afterEach, expect, test } from 'bun:test'
import { useState } from 'react'
import renderLogicHook from '@/tests/Helpers/renderLogicHook.tsx'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { RoleSummary } from '@/lib/Auth/Types/auth.types.ts'
import RoleCheckboxes from '@/features/Admin/UserManagement/Components/UserFormModal/Components/RoleCheckboxes.tsx'
import PermissionCheckboxes from '@/features/Admin/RoleManagement/Components/RoleFormModal/Components/PermissionCheckboxes.tsx'

const role: RoleSummary = {
    id: 'role-1',
    key: 'editor',
    name: 'Editor',
    description: '',
    isSystem: false,
    permissionKeys: [PERMISSIONS.USERS_VIEW],
    createdAt: new Date(),
    updatedAt: new Date(),
}
function useSelection() {
    const [selected, setSelected] = useState<string[]>([])
    return {
        selected,
        field: {
            name: 'selected',
            state: { value: selected, meta: { errors: [] } },
            handleChange: setSelected,
        },
    }
}
let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
    await dispose?.()
    dispose = undefined
})

test('role checkboxes add and remove the chosen role without changing other selections', async () => {
    const hook = await renderLogicHook(useSelection, (value) => (
        <RoleCheckboxes disabled={false} field={value.field} roles={[role]} />
    ))
    dispose = hook.dispose
    const input = hook.container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(input).not.toBeNull()
    await hook.run(() => input?.click())
    expect(hook.current.selected).toEqual([role.key])
    await hook.run(() => input?.click())
    expect(hook.current.selected).toEqual([])
})

test('permission controls toggle actual selected permissions and search without submitting on Enter', async () => {
    const hook = await renderLogicHook(useSelection, (value) => (
        <PermissionCheckboxes
            disabled={false}
            availablePermissionKeys={[PERMISSIONS.USERS_VIEW, PERMISSIONS.ROLES_VIEW]}
            field={value.field}
        />
    ))
    dispose = hook.dispose
    const input = hook.container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(input).not.toBeNull()
    await hook.run(() => input?.click())
    expect(hook.current.selected).toHaveLength(1)
    await hook.run(() => input?.click())
    expect(hook.current.selected).toEqual([])
    const search = hook.container.querySelector<HTMLInputElement>('input[type="search"]')
    expect(search).not.toBeNull()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    await hook.run(() => search?.dispatchEvent(enter))
    expect(enter.defaultPrevented).toBe(true)
    await hook.run(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            search,
            'no-such-permission',
        )
        search?.dispatchEvent(new Event('input', { bubbles: true }))
        search?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(hook.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(hook.container.textContent).toContain('No permissions')
})
