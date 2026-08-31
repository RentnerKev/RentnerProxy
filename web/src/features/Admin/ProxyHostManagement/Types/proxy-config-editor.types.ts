import type {
    ProxyConfigSource,
    ProxyHostConfigEditorData,
} from '../../../../shared/Types/proxy-runtime.types'

import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'

export type ProxyConfigEditorTab = 'edit' | 'active' | 'defaults' | 'preview'

export interface ProxyConfigEditorModalProps {
    readonly proxyHost: ProxyHostSummary
    readonly canAdvancedConfig?: boolean
    readonly canEdit: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
}

export type ProxyConfigEditorLogicProps = ProxyConfigEditorModalProps

export interface ProxyConfigEditorDraft {
    readonly advancedConfig: string
    readonly advancedBaseline: string
    readonly baseRevision: string
    readonly baseline: string
    readonly source: string
    readonly template: string | null
}

export interface ProxyConfigEditorState {
    readonly actionError: string | null
    readonly actionErrorLine: number | null
    readonly activeTab: ProxyConfigEditorTab
    readonly advancedAvailable: boolean
    readonly advancedConfig: string
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
    readonly previewErrorLine: number | null
    readonly templateAvailable: boolean
    readonly draft: string
}

export interface ProxyConfigEditorHandlers {
    readonly confirmReload: () => Promise<void>
    readonly confirmReset: () => Promise<void>
    readonly preview: () => void
    readonly refresh: () => void
    readonly reset: () => void
    readonly save: () => void
    readonly setActiveTab: (tab: ProxyConfigEditorTab) => void
    readonly setAdvancedConfig: (value: string) => void
    readonly setDraft: (value: string) => void
    readonly setReloadConfirmationOpen: (open: boolean) => void
    readonly setResetConfirmationOpen: (open: boolean) => void
}

export interface ProxyConfigEditorLogic {
    readonly handler: ProxyConfigEditorHandlers
    readonly state: ProxyConfigEditorState
}
