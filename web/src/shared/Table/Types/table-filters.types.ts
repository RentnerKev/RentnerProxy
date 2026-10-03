import type { ReactNode } from 'react'

export interface TableFiltersProps {
    readonly children: (resetButton: ReactNode) => ReactNode
    readonly contentId: string
    readonly expanded: boolean
    readonly activeCount?: number
    readonly onReset?: () => void
}
