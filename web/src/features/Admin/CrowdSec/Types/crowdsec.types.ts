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
    }
}

export interface CrowdSecPageViewProps {
    readonly logic: CrowdSecPageLogic
}
