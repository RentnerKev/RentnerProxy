import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ColumnDef } from '@tanstack/react-table'
import type { Root } from 'react-dom/client'
import type { ClientTable, ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { filterFn_equalsString } = await import('@tanstack/react-table')
const { default: useClientTable } = await import('@/shared/Table/Hooks/useClientTable.ts')
const { default: DataTable } = await import('@/shared/Table/index.tsx')
type Host = { id: string; domain: string; status: string }
const hosts: Host[] = [
    { id: 'enabled', domain: 'enabled.test', status: 'enabled' },
    { id: 'disabled', domain: 'disabled.test', status: 'disabled' },
]
const columns: ColumnDef<ClientTableFeatures, Host>[] = [
    { accessorKey: 'domain', header: 'Domain', enableColumnFilter: false },
    { accessorKey: 'status', header: 'Status', filterFn: filterFn_equalsString },
]
const getRowId = (row: Host) => row.id
let root: Root | undefined
let table: ClientTable<Host>
function Fixture({ data = hosts, loading = false }: { data?: Host[]; loading?: boolean }) {
    const logic = useClientTable({
        data,
        columns,
        getRowId,
        initialColumnVisibility: { status: false },
    })
    useEffect(() => {
        table = logic.table
    })
    return (
        <DataTable
            table={logic.table}
            eyebrow="Inventory"
            title="Hosts"
            searchInput={logic.state.searchInput}
            searchLabel="Search hosts"
            searchPlaceholder="Search hosts"
            showColumnFilters
            onSearchChange={logic.handler.handleSearchInputChange}
            onToggleColumnFilters={() => undefined}
            onResetFilters={logic.handler.handleResetFilters}
            columnFilterConfigs={{
                status: {
                    type: 'select',
                    placeholder: 'All statuses',
                    options: [
                        { value: 'enabled', label: 'Enabled' },
                        { value: 'disabled', label: 'Disabled' },
                    ],
                },
            }}
            isLoading={loading}
            loadingLabel="Loading hosts"
            emptyState={{ title: 'No hosts', description: 'No saved hosts.' }}
            filteredEmptyState={{ title: 'No matches', description: 'Change filters.' }}
            itemLabel="hosts"
        />
    )
}
async function render(data = hosts, loading = false) {
    if (!root) {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
    }
    await act(async () => root!.render(withTestLanguage(<Fixture data={data} loading={loading} />)))
}
async function click(element: Element) {
    await act(async () =>
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
}
afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
})
test('a hidden column stays filterable without rendering a header or body cells', async () => {
    await render()
    expect(document.querySelectorAll('thead th')).toHaveLength(1)
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(document.querySelector('[aria-label="status cell"]') === null).toBe(true)
    await click(document.querySelector('[role="combobox"][aria-label="All statuses"]')!)
    const disabled = [...document.querySelectorAll('[role="option"]')].find(
        (option) => option.textContent?.trim() === 'Disabled',
    )!
    await act(async () => {
        disabled.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }),
        )
        disabled.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(document.querySelector('tbody')?.textContent).toBe('disabled.test')
    await click(
        [...document.querySelectorAll('button')].find(
            (button) => button.textContent?.trim() === 'Reset filters',
        )!,
    )
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(document.querySelectorAll('thead th')).toHaveLength(1)
})
test('loading and empty row spans follow native column visibility changes', async () => {
    await render([], true)
    expect(
        [...document.querySelectorAll('tbody tr')].every((row) => row.children.length === 1),
    ).toBe(true)
    await render([])
    expect(document.querySelector('tbody td')?.getAttribute('colspan')).toBe('1')
    await act(async () => table.setColumnVisibility({ status: true }))
    expect(document.querySelectorAll('thead th')).toHaveLength(2)
    expect(document.querySelector('tbody td')?.getAttribute('colspan')).toBe('2')
    await render([], true)
    expect(
        [...document.querySelectorAll('tbody tr')].every((row) => row.children.length === 2),
    ).toBe(true)
})
