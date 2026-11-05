import { afterEach, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ColumnDef } from '@tanstack/react-table'
import type { Root } from 'react-dom/client'
import type { ClientTable, ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: useClientTable } = await import('@/shared/Table/Hooks/useClientTable.ts')

type Record = { id: string; createdAt: Date; count: number }
const data: Record[] = [
    { id: 'middle', createdAt: new Date('2025-01-01'), count: 2 },
    { id: 'newest', createdAt: new Date('2026-01-01'), count: 10 },
    { id: 'oldest', createdAt: new Date('2020-01-01'), count: 1 },
]
const columns: ColumnDef<ClientTableFeatures, Record>[] = [
    { accessorKey: 'createdAt', header: 'Created' },
    { accessorKey: 'count', header: 'Count' },
]
let root: Root | undefined
let currentTable: ClientTable<Record>

function Fixture() {
    const { table } = useClientTable({ data, columns, getRowId: (row) => row.id })
    useEffect(() => {
        currentTable = table
    }, [table])
    return (
        <>
            {['createdAt', 'count'].map((id) => (
                <button key={id} onClick={() => table.getColumn(id)?.toggleSorting()}>
                    {id}
                </button>
            ))}
            <output>
                {table
                    .getRowModel()
                    .rows.map((row) => row.original.id)
                    .join(',')}
            </output>
        </>
    )
}

afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
})

test.each(['createdAt', 'count'] as const)(
    'auto sorting orders %s in both directions',
    async (column) => {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        await act(async () => root!.render(<Fixture />))
        const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
            (item) => item.textContent === column,
        )!
        await act(async () => button.click())
        expect(currentTable.getRowModel().rows.map((row) => row.original.id)).toEqual([
            'newest',
            'middle',
            'oldest',
        ])
        await act(async () => button.click())
        expect(currentTable.getRowModel().rows.map((row) => row.original.id)).toEqual([
            'oldest',
            'middle',
            'newest',
        ])
    },
)
