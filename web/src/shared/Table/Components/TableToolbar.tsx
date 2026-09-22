import { SearchInput } from '@rentnerkev/inputs'
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
            <SearchInput
                id={searchId}
                type="search"
                icon={<Search aria-hidden="true" strokeWidth={1.8} />}
                value={searchInput}
                maxLength={200}
                placeholder={searchPlaceholder}
                onChange={(event) => onSearchChange(event.target.value)}
            />
        </label>
    )
}
