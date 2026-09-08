import type {
    ProxyConfigSource,
    ProxyHostConfigEditorData,
    ProxyConfigEditorData,
    ProxyHttpSettings,
} from '../../../../shared/Types/proxy-runtime.types'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'

export type ProxyConfigEditorTab = 'edit' | 'active' | 'defaults' | 'preview'

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
    readonly actionError: string | null
    readonly activeTab: ProxyConfigEditorTab
    readonly settings: ProxyHttpSettings
    readonly baseRevision: string | null
    readonly data: ProxyHostConfigEditorData | undefined
    readonly isError: boolean
    readonly isLoading: boolean
    readonly isPreviewing: boolean
    readonly isRefreshing: boolean
    readonly isReloadConfirmationOpen: boolean
    readonly isResetConfirmationOpen: boolean
    readonly isResetting: boolean
    readonly isSaving: boolean
    readonly preview: ProxyConfigSource | null
    readonly previewError: string | null
    readonly isDirty: boolean
}

export interface ProxyConfigEditorHandlers {
    readonly confirmReload: () => Promise<void>
    readonly confirmReset: () => Promise<void>
    readonly preview: () => void
    readonly refresh: () => void
    readonly reset: () => void
    readonly save: () => void
    readonly setActiveTab: (tab: ProxyConfigEditorTab) => void
    readonly setSetting: (key: keyof ProxyHttpSettings, value: number | undefined) => void
    readonly setReloadConfirmationOpen: (open: boolean) => void
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
    readonly actionError: string | null
    readonly activeTab: ProxyConfigEditorTab
    readonly settings: ProxyHttpSettings
    readonly baseRevision: string | null
    readonly data: ProxyConfigEditorData | undefined
    readonly isLoading: boolean
    readonly isRefreshing: boolean
    readonly isSaving: boolean
    readonly isResetting: boolean
    readonly isPreviewing: boolean
    readonly preview: ProxyConfigSource | null
}
