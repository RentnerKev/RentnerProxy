import type { CrowdSecMode } from '../../../../config/crowdsec.config'
import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'

export interface CrowdSecPageProps {
    readonly permissions: readonly string[]
}

export interface CrowdSecPageState {
    readonly canUpdate: boolean
    readonly configuration: CrowdSecConfiguration | undefined
    readonly mode: CrowdSecMode
    readonly apiUrl: string
    readonly apiKey: string
    readonly fieldErrors: {
        readonly apiUrl?: string
        readonly apiKey?: string
    }
    readonly isDirty: boolean
    readonly isError: boolean
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly isSaving: boolean
    readonly isTesting: boolean
    readonly transition: CrowdSecTransition | null
    readonly transitionProgress: CrowdSecTransitionProgress | null
}

export type CrowdSecTransitionMode = 'managed' | 'disabled'

export interface CrowdSecTransition {
    readonly targetMode: CrowdSecTransitionMode
    readonly startedAt: number
    readonly phase: 'running' | 'delayed' | 'complete' | 'error'
    readonly connectionInterrupted: boolean
    readonly runtimePending: boolean
    readonly errorMessage: string | null
}

export interface CrowdSecTransitionProgress {
    readonly percent: number
    readonly activeStep: number
    readonly complete: boolean
    readonly healthDegraded: boolean
}

export interface CrowdSecPageLogic {
    readonly state: CrowdSecPageState
    readonly handler: {
        readonly retry: () => void
        readonly setMode: (mode: CrowdSecMode) => void
        readonly setApiUrl: (value: string) => void
        readonly setApiKey: (value: string) => void
        readonly testConnection: () => void
        readonly save: () => void
        readonly closeTransition: () => void
    }
}

export interface CrowdSecPageViewProps {
    readonly logic: CrowdSecPageLogic
}
