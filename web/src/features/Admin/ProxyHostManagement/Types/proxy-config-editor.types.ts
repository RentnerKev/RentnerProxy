import type {
    ProxyHostConfigEditorData,
    ProxyConfigEditorData,
    ProxyHttpSettings,
} from '../../../../shared/Types/proxy-runtime.types'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'

export type ProxyConfigEditorTab = 'edit' | 'active'

export interface ProxyConfigEditorModalProps {
    readonly proxyHost: ProxyHostSummary
    readonly canEdit: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
}

export type ProxyConfigEditorLogicProps = ProxyConfigEditorModalProps

export interface ProxyConfigEditorDraft {
    readonly settings: ProxyHttpSettings
    readonly baselineSettings: ProxyHttpSettings
    readonly baseRevision: string
}

export interface ProxyConfigEditorState {
    readonly activeTab: ProxyConfigEditorTab
    readonly settings: ProxyHttpSettings
    readonly baseRevision: string | null
    readonly data: ProxyHostConfigEditorData | undefined
    readonly isError: boolean
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly isResetConfirmationOpen: boolean
    readonly isResetting: boolean
    readonly isSaving: boolean
}

export interface ProxyConfigEditorHandlers {
    readonly confirmReset: () => Promise<void>
    readonly reset: () => void
    readonly save: () => void
    readonly setActiveTab: (tab: ProxyConfigEditorTab) => void
    readonly setSetting: (key: keyof ProxyHttpSettings, value: number | undefined) => void
    readonly setResetConfirmationOpen: (open: boolean) => void
}

export interface ProxyConfigEditorLogic {
    readonly handler: ProxyConfigEditorHandlers
    readonly state: ProxyConfigEditorState
}

export interface ProxyGlobalConfigEditorModalProps {
    readonly canEdit: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
}

export interface ProxyGlobalConfigEditorState {
    readonly isResetConfirmationOpen: boolean
    readonly activeTab: 'edit' | 'active'
    readonly settings: ProxyHttpSettings
    readonly baseRevision: string | null
    readonly data: ProxyConfigEditorData | undefined
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly isSaving: boolean
    readonly isResetting: boolean
}
