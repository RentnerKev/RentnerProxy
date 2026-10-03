export interface TableToolbarProps {
    readonly searchInput: string
    readonly searchId: string
    readonly searchLabel: string
    readonly searchPlaceholder: string
    readonly onSearchChange: (value: string) => void
}
