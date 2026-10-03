export interface TableFilterToggleProps {
    readonly contentId: string
    readonly expanded: boolean
    readonly onToggle: () => void
    readonly activeCount?: number
}
