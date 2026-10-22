import { useCallback, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type {
    BulkHostSelectionParams,
    BulkHostSelectionResult,
} from '../Types/bulk-hosts-ui.types.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import { BULK_HOST_LIMITS } from '@/config/bulk-hosts.config.ts'
import { availableBulkHostActions } from '@/lib/HostBulkActions/bulkHostActions.ts'
import { HostBulkSelectionCell } from '../Components/HostBulkSelectionCell.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

const emptyIds: string[] = []

export default function useHostBulkSelection<
    T extends { readonly id: string; readonly domains: readonly string[] },
>({ kind, permissions, scope, disabled }: BulkHostSelectionParams): BulkHostSelectionResult<T> {
    const { t } = useTranslationStore()
    const [selection, setSelection] = useState({ scope, ids: [] as string[], open: false })
    // A filter change starts a new explicit selection, including when returning to an old filter.
    if (selection.scope !== scope) setSelection({ scope, ids: [], open: false })
    const ids = selection.scope === scope ? selection.ids : emptyIds
    const open = selection.scope === scope && selection.open
    const enabled = availableBulkHostActions(kind, permissions).length > 0
    const toggle = useCallback(
        (id: string) => {
            setSelection((current) => {
                if (disabled || current.open || current.scope !== scope) return current
                const next = current.ids.includes(id)
                    ? current.ids.filter((value) => value !== id)
                    : current.ids.length < BULK_HOST_LIMITS.hosts
                      ? [...current.ids, id]
                      : current.ids
                return { ...current, ids: next }
            })
        },
        [disabled, scope],
    )
    const clear = useCallback(() => setSelection({ scope, ids: [], open: false }), [scope])
    const selectPage = useCallback(
        (pageIds: readonly string[]) => {
            if (disabled || open) return
            setSelection((current) => ({
                scope,
                ids: [...new Set([...current.ids, ...pageIds])].slice(0, BULK_HOST_LIMITS.hosts),
                open: false,
            }))
        },
        [disabled, open, scope],
    )
    const setOpen = useCallback(
        (value: boolean) => setSelection((current) => ({ ...current, open: value })),
        [],
    )
    const column = useMemo<ColumnDef<ClientTableFeatures, T>>(
        () => ({
            id: 'selection',
            header: t('admin.bulkHosts.selection'),
            enableSorting: false,
            enableColumnFilter: false,
            enableGlobalFilter: false,
            cell: HostBulkSelectionCell<T>,
        }),
        [t],
    )
    return {
        column,
        state: { ids, open, enabled, disabled },
        handler: { toggle, clear, selectPage, setOpen },
    }
}
