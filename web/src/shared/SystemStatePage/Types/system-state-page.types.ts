import type { ReactNode } from 'react'

export interface SystemStatePageProps {
    readonly announce?: boolean
    readonly children: ReactNode
    readonly code: string
    readonly description: string
    readonly details?: ReactNode
    readonly eyebrow: string
    readonly imageSrc: string
    readonly title: string
}

export interface UseGlobalErrorPageLogicParams {
    readonly error: unknown
    readonly reset: () => void
}
export interface GlobalErrorPageLogicResult {
    readonly state: {
        readonly details: ReturnType<typeof import('@/lib/Errors/pageError.ts').getPageErrorDetails>
    }
    readonly handler: { readonly retry: () => void }
}
