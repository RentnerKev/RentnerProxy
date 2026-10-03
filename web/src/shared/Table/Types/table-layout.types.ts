import type { ReactNode } from 'react'

export interface TableLayoutProps {
    readonly titleId: string
    readonly title: string
    readonly eyebrow: string
    readonly description?: string | undefined
    readonly toolbar?: ReactNode
    readonly filterToggle?: ReactNode
    readonly filters?: ReactNode
    readonly pagination?: ReactNode
    readonly children: ReactNode
}
