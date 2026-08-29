import type { ReactNode } from 'react'

export interface PageHeaderProps {
    readonly action?: ReactNode
    readonly description: string
    readonly eyebrow: string
    readonly title: string
}

export interface ContentStateProps {
    readonly action?: ReactNode
    readonly busy?: boolean
    readonly description: string
    readonly title: string
}
