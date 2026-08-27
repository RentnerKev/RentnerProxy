import type { ReactNode } from 'react'

export interface SystemStatePageProps {
    readonly announce?: boolean
    readonly children: ReactNode
    readonly code: string
    readonly description: string
    readonly eyebrow: string
    readonly imageSrc: string
    readonly title: string
}
