import type {
    ProxyHostConfigEditorData,
    ProxyConfigEditorData,
    ProxyHttpSettings,
} from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'

export type ProxyConfigEditorTab = 'edit' | 'active'

export interface ProxyConfigEditorModalProps {
    readonly proxyHost: ProxyHostSummary
    readonly canEdit: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
}

export type ProxyConfigEditorLogicProps = ProxyConfigEditorModalProps

export interface ProxyConfigEditorState {
    readonly isValid: boolean
    readonly hasConflict: boolean
    readonly reviewedLatest: ProxyHttpSettings | null
    readonly isConflictConfirmationOpen: boolean
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
    readonly reviewLatest: () => Promise<void>
    readonly keepDraft: () => void
    readonly useSaved: () => void
    readonly acceptDraft: () => void
    readonly setConflictConfirmationOpen: (open: boolean) => void
    readonly confirmReset: () => Promise<void>
    readonly reset: () => void
    readonly save: () => void
    readonly setActiveTab: (tab: ProxyConfigEditorTab) => void
    readonly setSetting: <K extends keyof ProxyHttpSettings>(
        key: K,
        value: ProxyHttpSettings[K],
    ) => void
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
    readonly hasConflict: boolean
    readonly reviewedLatest: ProxyHttpSettings | null
    readonly isConflictConfirmationOpen: boolean
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

export interface ProxyConfigEditorSubmission {
    readonly settings: ProxyHttpSettings
    readonly baseRevision: string
}
