import { afterEach, expect, mock, test } from 'bun:test'
import { flexRender } from '@tanstack/react-table'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import renderLogicHook from '@/tests/Helpers/renderLogicHook.tsx'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import useAccessPoliciesTableLogic from '@/features/Admin/AccessPolicyManagement/Components/AccessPoliciesTable/Hooks/useAccessPoliciesTableLogic.ts'
import AccessPoliciesTable from '@/features/Admin/AccessPolicyManagement/Components/AccessPoliciesTable/index.tsx'

const policy: AccessPolicySummary = {
    id: 'policy-1',
    name: 'Office',
    description: '',
    mode: 'combined',
    combination: 'all',
    ipRules: { defaultAction: 'deny', allow: ['192.0.2.0/24'], deny: [] },
    forwardAuth: null,
    assignedHostCount: 0,
    basicAuthAccountCount: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date(),
}
const publicPolicy: AccessPolicySummary = {
    ...policy,
    id: 'policy-2',
    name: 'Public site',
    mode: 'public',
    combination: null,
    ipRules: null,
    basicAuthAccountCount: 0,
}
let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
    await dispose?.()
    dispose = undefined
})

test('policy table renders every policy field and searches modes, counts and network rules through actual TanStack filters', async () => {
    const props = {
        policies: [policy, publicPolicy],
        canDelete: true,
        canUpdate: true,
        canViewCredentials: true,
        isLoading: false,
        isPending: false,
        onEdit: mock((_value: AccessPolicySummary) => undefined),
        onDelete: mock((_value: AccessPolicySummary) => undefined),
        onCredentials: mock((_value: AccessPolicySummary) => undefined),
    }
    const hook = await renderLogicHook(
        () => useAccessPoliciesTableLogic(props),
        (value) => (
            <TooltipProvider>
                <table>
                    <tbody>
                        {value.table.getRowModel().rows.map((row) => (
                            <tr key={row.id}>
                                {row.getVisibleCells().map((cell) => (
                                    <td key={cell.id}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TooltipProvider>
        ),
    )
    dispose = hook.dispose
    expect(hook.container.textContent).toContain('Office')
    expect(hook.container.textContent).toContain('Public site')
    expect(hook.container.querySelectorAll('tbody tr').length).toBe(2)
    await hook.run((value) => value.table.setGlobalFilter('192.0.2'))
    expect(hook.current.table.getRowModel().rows.map((row) => row.original.id)).toEqual([policy.id])
    await hook.run((value) => value.table.setGlobalFilter('no-such-policy'))
    expect(hook.current.table.getRowModel().rows).toHaveLength(0)
    await hook.run((value) => value.handler.handleResetFilters())
    expect(hook.current.table.getRowModel().rows).toHaveLength(2)
    await hook.run((value) => value.table.setColumnFilters([{ id: 'mode', value: 'public' }]))
    expect(hook.current.table.getRowModel().rows.map((row) => row.original.id)).toEqual([
        publicPolicy.id,
    ])
    await hook.run((value) => value.handler.toggleColumnFilters())
    expect(hook.current.state.showColumnFilters).toBe(true)
    await hook.run((value) => value.handler.toggleColumnFilters())
    expect(hook.current.state.showColumnFilters).toBe(false)
})

test('policy component action menu routes edit, credentials and delete to the selected policy', async () => {
    const edit = mock((_value: AccessPolicySummary) => undefined)
    const remove = mock((_value: AccessPolicySummary) => undefined)
    const credentials = mock((_value: AccessPolicySummary) => undefined)
    const hook = await renderLogicHook(
        () => null,
        () => (
            <TooltipProvider>
                <AccessPoliciesTable
                    policies={[policy]}
                    canDelete
                    canUpdate
                    canViewCredentials
                    isLoading={false}
                    isPending={false}
                    onEdit={edit}
                    onDelete={remove}
                    onCredentials={credentials}
                />
            </TooltipProvider>
        ),
    )
    dispose = hook.dispose
    const openMenu = async () => {
        const trigger = [...hook.container.querySelectorAll('button')].find((button) =>
            button.getAttribute('aria-label')?.includes('Office'),
        )
        expect(trigger).toBeDefined()
        await hook.run(() =>
            trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })),
        )
    }
    await openMenu()
    const editItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
        item.textContent?.includes('Edit'),
    )
    expect(editItem).toBeDefined()
    await hook.run(() => editItem?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(edit).toHaveBeenCalledWith(policy)
    await openMenu()
    const credentialsItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
        /credentials|accounts/i.test(item.textContent ?? ''),
    )
    expect(credentialsItem).toBeDefined()
    await hook.run(() => credentialsItem?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(credentials).toHaveBeenCalledWith(policy)
    await openMenu()
    const deleteItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
        item.textContent?.includes('Delete'),
    )
    expect(deleteItem).toBeDefined()
    await hook.run(() => deleteItem?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(remove).toHaveBeenCalledWith(policy)
})
