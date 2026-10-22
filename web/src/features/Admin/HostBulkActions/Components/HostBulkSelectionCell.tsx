import { createContext, useContext } from 'react'
import type { CellContext } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { BulkHostSelectionContextValue } from '../Types/bulk-hosts-ui.types.ts'
import { BULK_HOST_LIMITS } from '@/config/bulk-hosts.config.ts'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export const HostBulkSelectionContext = createContext<BulkHostSelectionContextValue | null>(null)

// Keep this renderer stable: replacing a TanStack cell component would discard keyboard focus.
export function HostBulkSelectionCell<
    T extends { readonly id: string; readonly domains: readonly string[] },
>({ row }: CellContext<ClientTableFeatures, T>) {
    const selection = useContext(HostBulkSelectionContext)
    const { t } = useTranslationStore()
    return selection ? (
        <OptionToggle
            iconOnly
            label={t('admin.bulkHosts.selectHost', {
                name: row.original.domains[0] ?? row.id,
            })}
            checked={selection.ids.includes(row.id)}
            disabled={
                selection.disabled ||
                selection.open ||
                (!selection.ids.includes(row.id) && selection.ids.length >= BULK_HOST_LIMITS.hosts)
            }
            onChange={() => selection.toggle(row.id)}
        />
    ) : null
}
