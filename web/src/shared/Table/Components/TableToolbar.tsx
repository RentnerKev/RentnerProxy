import { Search } from 'lucide-react'

interface TableToolbarProps {
    readonly searchInput: string
    readonly searchId: string
    readonly searchLabel: string
    readonly searchPlaceholder: string
    readonly onSearchChange: (value: string) => void
}

export default function TableToolbar({
    searchInput,
    searchId,
    searchLabel,
    searchPlaceholder,
    onSearchChange,
}: TableToolbarProps) {
    return (
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
                className="box-border h-12 w-full rounded-xl border border-input-border bg-surface-raised pr-3 pl-9 text-sm text-ink outline-hidden transition-[border-color,box-shadow] placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20"
            />
        </label>
    )
}
