import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import useTableFilters from '../Hooks/useTableFilters'

interface TableFiltersProps {
    readonly children: ReactNode
    readonly activeCount?: number
    readonly onReset: () => void
    readonly expanded?: boolean
    readonly onExpandedChange?: (expanded: boolean) => void
}

export default function TableFilters({
    children,
    activeCount = 0,
    onReset,
    expanded,
    onExpandedChange,
}: TableFiltersProps) {
    const { t } = useTranslationStore()
    const { contentId, open, toggle } = useTableFilters(expanded, onExpandedChange)

    return (
        <div className="border-b border-border px-[1.15rem] py-3">
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    onClick={toggle}
                    className={`inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${open || activeCount > 0 ? 'border-brand-600/40 bg-success-bg text-brand-text' : 'border-border-strong bg-surface-raised text-muted hover:border-brand-600 hover:text-brand-text'}`}
                >
                    <ListFilter aria-hidden="true" className="size-4 shrink-0" />
                    {t('table.filters')}
                    {activeCount > 0 ? ` (${activeCount})` : ''}
                </button>
                {activeCount > 0 ? (
                    <button
                        type="button"
                        onClick={onReset}
                        className="inline-flex h-12 cursor-pointer items-center justify-center rounded-xl border border-transparent px-3 text-sm font-extrabold text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                    >
                        {t('table.resetFilters')}
                    </button>
                ) : null}
            </div>
            <div id={contentId} hidden={!open}>
                <div className="pt-4">{children}</div>
            </div>
        </div>
    )
}
