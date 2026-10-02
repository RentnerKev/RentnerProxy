import type { PropsWithChildren, ReactNode } from 'react'

export interface AuthShellProps extends PropsWithChildren {
    readonly description: string
    readonly eyebrow: string
    readonly footer?: ReactNode
    readonly title: string
}
