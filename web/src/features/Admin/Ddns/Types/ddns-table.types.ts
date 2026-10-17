import type { DdnsRecordError, DdnsTarget } from '@/lib/Ddns/Types/ddns.types.ts'
export interface DdnsRecordRow {
    readonly target: DdnsTarget
    readonly connectionLabel: string
    readonly zone: string
    readonly address: string
    readonly lastSuccess: string
    readonly nextAttempt: string
    readonly error: DdnsRecordError | null
    readonly statusKey: string
}
export interface DdnsRecordActions {
    readonly canManage: boolean
    readonly locked: boolean
    readonly onEdit: (target: DdnsTarget) => void
    readonly onToggle: (target: DdnsTarget) => void
    readonly onDelete: (target: DdnsTarget) => void
}
export interface DdnsRecordCellProps {
    readonly row: DdnsRecordRow
}
export interface DdnsActionCellProps extends DdnsRecordActions, DdnsRecordCellProps {}
export interface DdnsRecordsProps extends DdnsRecordActions {
    readonly rows: DdnsRecordRow[]
    readonly canAdd: boolean
    readonly onAdd: () => void
}
