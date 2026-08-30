import type { RowData } from '@tanstack/react-table'
import { ListFilter, Search } from 'lucide-react'

import { uiClassNames } from '../../Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'
import type { TableToolbarProps } from '../Types/table.types'

export default function TableToolbar<TData extends RowData>({
    table,
    titleId,
    eyebrow,
    title,
    description,
    searchInput,
    searchId,
    searchLabel,
    searchPlaceholder,
    showColumnFilters,
    enableColumnFilters,
    onSearchChange,
    onToggleColumnFilters,
    onResetFilters,
    action,
}: TableToolbarProps<TData>) {
    const { t } = useTranslationStore()

    return (
        <div className="flex flex-col gap-4 border-b border-border px-[1.15rem] py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0">
                    <p className={uiClassNames.themedTechnicalLabel}>{eyebrow}</p>
                    <h2 id={titleId} className="mt-[0.4rem] text-xl text-ink-soft">
                        {title}
                    </h2>
                    {description ? (
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
                            {description}
                        </p>
                    ) : null}
                </div>

                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
                    <label htmlFor={searchId} className="relative min-w-0 flex-1 sm:w-72">
                        <span className="sr-only">{searchLabel}</span>
                        <Search
                            aria-hidden="true"
                            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                            strokeWidth={1.8}
                        />
                        <input
                            id={searchId}
                            type="search"
                            value={searchInput}
                            maxLength={200}
                            placeholder={searchPlaceholder}
                            onChange={(event) => onSearchChange(event.target.value)}
                            className="box-border h-10 w-full rounded-xl border border-input-border bg-surface-raised pr-3 pl-9 text-sm text-ink outline-hidden transition-[border-color,box-shadow] placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20"
                        />
                    </label>

                    <table.Subscribe
                        source={table.atoms.columnFilters}
                        selector={(columnFilters) => columnFilters.length > 0}
                    >
                        {(hasColumnFilters) => {
                            const hasActiveFilters =
                                hasColumnFilters || searchInput.trim().length > 0

                            return (
                                <div className="flex items-center gap-2">
                                    {enableColumnFilters ? (
                                        <button
                                            type="button"
                                            onClick={onToggleColumnFilters}
                                            aria-pressed={showColumnFilters}
                                            className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-extrabold transition-[background-color,border-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${showColumnFilters || hasColumnFilters ? 'border-brand-600/40 bg-success-bg text-brand-text' : 'border-border-strong bg-surface-raised text-muted hover:border-brand-600 hover:text-brand-text'}`}
                                        >
                                            <ListFilter
                                                aria-hidden="true"
                                                className="size-4"
                                                strokeWidth={1.8}
                                            />
                                            {t('table.filters')}
                                        </button>
                                    ) : null}
                                    {hasActiveFilters ? (
                                        <button
                                            type="button"
                                            onClick={onResetFilters}
                                            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-transparent px-3 text-sm font-extrabold text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                                        >
                                            {t('table.resetFilters')}
                                        </button>
                                    ) : null}
                                </div>
                            )
                        }}
                    </table.Subscribe>

                    {action ? <div className="sm:ml-1">{action}</div> : null}
                </div>
            </div>
        </div>
    )
}
