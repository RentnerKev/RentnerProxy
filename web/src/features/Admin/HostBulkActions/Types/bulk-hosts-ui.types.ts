import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { HostKind } from '@/lib/HostTags/Types/host-tags.types.ts'
import type {
    BulkHostAction,
    BulkHostResult,
} from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import type { ColumnDef } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'

export interface BulkHostModalProps {
    readonly kind: HostKind
    readonly permissions: readonly PermissionKey[]
    readonly hostIds: readonly string[]
    readonly onOpenChange: (open: boolean) => void
}
export interface BulkHostToolbarProps extends Omit<BulkHostModalProps, 'hostIds'> {
    readonly ids: readonly string[]
    readonly open: boolean
    readonly disabled: boolean
    readonly onSelectPage: () => void
    readonly onClear: () => void
}
export interface BulkHostFormValues {
    type: BulkHostAction['type']
    tagIds: string[]
    assignmentId: string
}
export interface BulkHostModalLogicResult {
    readonly state: {
        readonly id: string
        readonly values: BulkHostFormValues
        readonly pending: boolean
        readonly error: string | null
        readonly result: BulkHostResult | null
        readonly rows: BulkHostResult['rows']
        readonly canApply: boolean
        readonly canPreview: boolean
        readonly actionOptions: { value: BulkHostAction['type']; label: string }[]
        readonly assignmentOptions: { value: string; label: string }[]
        readonly optionsLoading: boolean
        readonly optionsError: boolean
    }
    readonly handler: {
        readonly handleTypeChange: (type: BulkHostAction['type']) => void
        readonly handleTagsChange: (tagIds: string[]) => void
        readonly handleAssignmentChange: (assignmentId: string) => void
        readonly handlePreview: () => void
        readonly handleApply: () => void
        readonly handleRetryOptions: () => void
    }
}
export interface BulkHostSelectionParams {
    readonly kind: HostKind
    readonly permissions: readonly PermissionKey[]
    readonly scope: string
    readonly disabled: boolean
}
export interface BulkHostSelectionContextValue {
    readonly ids: readonly string[]
    readonly disabled: boolean
    readonly open: boolean
    readonly toggle: (id: string) => void
}
export interface BulkHostSelectionResult<T extends { readonly id: string }> {
    readonly column: ColumnDef<ClientTableFeatures, T>
    readonly state: {
        readonly ids: string[]
        readonly open: boolean
        readonly enabled: boolean
        readonly disabled: boolean
    }
    readonly handler: {
        readonly toggle: (id: string) => void
        readonly clear: () => void
        readonly selectPage: (pageIds: readonly string[]) => void
        readonly setOpen: (open: boolean) => void
    }
}
export interface BulkHostTableState {
    readonly bulkIds: readonly string[]
    readonly bulkOpen: boolean
    readonly bulkEnabled: boolean
    readonly bulkDisabled: boolean
}
export interface BulkHostTableHandler {
    readonly handleToggleSelection: (id: string) => void
    readonly handleSelectPage: () => void
    readonly handleClearSelection: () => void
    readonly handleBulkOpenChange: (open: boolean) => void
}
