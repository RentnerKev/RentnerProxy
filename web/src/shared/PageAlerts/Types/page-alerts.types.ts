import type { ReactNode } from 'react'

export interface PageAlertProps {
    readonly severity: 'warning' | 'error'
    readonly title: string
    readonly description: string
    readonly action?: ReactNode
}

export interface RegisteredPageAlert extends PageAlertProps {
    readonly id: string
}

export interface PageAlertsRegistration {
    readonly setAlert: (id: string, alert: PageAlertProps | null) => void
}

export interface PageAlertsProviderProps {
    readonly children: ReactNode
}

export interface PageAlertsProviderLogicResult {
    readonly state: {
        readonly alerts: readonly RegisteredPageAlert[]
        readonly registration: PageAlertsRegistration
    }
}

export interface PageAlertsLogicResult {
    readonly state: {
        readonly alerts: readonly RegisteredPageAlert[]
        readonly severity: PageAlertProps['severity']
        readonly open: boolean
    }
    readonly handler: {
        readonly handleOpenChange: (open: boolean) => void
    }
}
