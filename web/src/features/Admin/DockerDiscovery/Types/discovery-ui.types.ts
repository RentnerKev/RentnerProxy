import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { FormEvent } from 'react'
import type { DockerDiscoverySnapshot } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import type { ClientTable } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type {
    DiscoveryAction,
    DiscoveryConnect,
    DiscoveryInspect,
    DiscoveryCandidate,
    DiscoveryOverview,
    DiscoveryRow,
} from '@/lib/DockerDiscovery/Types/management.types.ts'

export interface DiscoveryApi {
    status(): Promise<DiscoveryOverview>
    inspect(input: DiscoveryInspect): Promise<{ candidates: DiscoveryCandidate[] }>
    connect(input: DiscoveryConnect): Promise<{ revision: number }>
    change(input: DiscoveryAction): Promise<{ revision: number }>
}
export interface DockerDiscoveryPageProps {
    readonly permissions: readonly PermissionKey[]
    readonly api: DiscoveryApi
    readonly liveEnabled?: boolean
}
export interface DiscoveryConnectionContext {
    readonly connected: boolean
    readonly connectorRevision: number
    readonly endpoint: string
    readonly restorePaused: boolean
}
export interface DiscoveryConnectionRuntime {
    readonly status: DockerDiscoverySnapshot['status']
    readonly endpoint: string
    readonly locked: boolean
    readonly needsActivation: boolean
    readonly canEnable: boolean
    readonly canRetry: boolean
    readonly showRetry: boolean
    readonly appliedStatus: DiscoveryOverview['management']['runtimeStatus'] | null
}
export interface DiscoveryConnectionProps {
    readonly context: DiscoveryConnectionContext
    readonly runtime: DiscoveryConnectionRuntime
    readonly api: DiscoveryApi
    readonly pending: boolean
    readonly onClose: () => void
    readonly onDisconnect: () => Promise<boolean>
    readonly onEnable: () => void
    readonly onDisable: () => void
    readonly onRetry: () => void
    readonly onSave: (input: {
        endpoint: string
        connectorRevision: number
        acknowledgeRestore: boolean
    }) => Promise<boolean>
}
export type DiscoveryConfirmation =
    | {
          readonly kind: 'enable'
          readonly revision: number
          readonly previewToken: string
          readonly create: number
          readonly update: number
      }
    | {
          readonly kind: 'detach'
          readonly revision: number
          readonly key: string
          readonly name: string
      }
export interface DiscoveryTableProps {
    readonly rows: readonly DiscoveryRow[]
    readonly loading: boolean
    readonly locked: boolean
    readonly canDetach: boolean
    readonly onDetails: (row: DiscoveryRow) => void
    readonly onDetach: (row: DiscoveryRow) => void
}
export interface DiscoveryCellProps {
    readonly row: DiscoveryRow
}
export interface DiscoveryDetailsProps {
    readonly row: DiscoveryRow
    readonly candidate: DiscoveryCandidate | null
    readonly onClose: () => void
}
export type DiscoveryGuideMode = 'native' | 'appliance'
type DiscoveryGuideCopyTarget = 'compose' | 'command' | 'endpoint'
export interface DiscoveryGuideProps {
    readonly mode: DiscoveryGuideMode
    readonly onModeChange: (mode: DiscoveryGuideMode) => void
    readonly onClose: () => void
    readonly onCopy: (mode: DiscoveryGuideMode, part: DiscoveryGuideCopyTarget) => void
}
export interface DockerDiscoveryLogicResult {
    state: {
        canView: boolean
        canManage: boolean
        canActivate: boolean
        canDetach: boolean
        overview: DiscoveryOverview | undefined
        available: boolean
        locked: boolean
        busy: boolean
        loading: boolean
        connectorStatus: DockerDiscoverySnapshot['status']
        needsActivation: boolean
        canEnable: boolean
        canRetry: boolean
        showRetry: boolean
        connection: DiscoveryConnectionContext | null
        confirmation: DiscoveryConfirmation | null
        guide: boolean
        guideMode: DiscoveryGuideMode
        details: DiscoveryRow | null
        candidate: DiscoveryCandidate | null
    }
    handler: {
        openConnection(): void
        closeConnection(): void
        saveConnection: DiscoveryConnectionProps['onSave']
        disconnect(): Promise<boolean>
        openGuide(): void
        closeGuide(): void
        setGuideMode(mode: DiscoveryGuideMode): void
        copyExample: DiscoveryGuideProps['onCopy']
        showDetails(row: DiscoveryRow): void
        closeDetails(): void
        askEnable(): void
        askDetach(row: DiscoveryRow): void
        closeConfirmation(open: boolean): void
        confirm(): Promise<void>
        disable(): void
        retry(): void
    }
}
export interface DiscoveryTableLogicResult {
    table: ClientTable<DiscoveryRow>
    state: {
        searchInput: string
        showColumnFilters: boolean
        columnFilterConfigs: TableColumnFilterConfigs
    }
    handler: {
        handleSearchInputChange(value: string): void
        handleResetFilters(): void
        toggleColumnFilters(): void
    }
}
export interface DiscoveryConnectionLogicResult<TForm> {
    form: TForm
    state: {
        formId: string
        pending: boolean
        testing: boolean
        canSave: boolean
        canToggleSynchronization: boolean
    }
    handler: {
        test(): Promise<void>
        close(): void
        disconnect(): void
        toggleSynchronization(): void
        retry(): void
        submit(event: FormEvent<HTMLFormElement>): void
    }
}
