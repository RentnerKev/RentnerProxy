import type { KeyboardEvent } from 'react'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type {
    HostMonitoringPolicyView,
    HostMonitoringHistoryQuery,
    HostMonitoringSettings,
} from '@/lib/HostMonitoring/Types/host-monitoring.types.ts'
import type { HostMonitoringHistoryView } from '@/lib/HostMonitoring/Types/host-monitoring-client.types.ts'
import type {
    HostAvailability,
    MonitoringPeriod,
} from '@/lib/HostMonitoring/Types/host-monitoring-presentation.types.ts'
export interface HostAvailabilityBadgeProps {
    readonly availability: HostAvailability
    readonly className?: string
}
export interface HostMonitoringDialogProps {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly host: ProxyHostSummary
    readonly permissions: readonly string[]
}
export type MonitoringTab = 'overview' | 'settings'
export interface MonitoringHistoryPageParam {
    readonly before: NonNullable<HostMonitoringHistoryQuery['before']>
    readonly since: string | undefined
}
export interface MonitoringHistoryPage extends HostMonitoringHistoryView {
    readonly windowSince: string | undefined
}
export type NumericMonitoringSetting = Exclude<keyof HostMonitoringSettings, 'domain' | 'enabled'>
export interface MonitoringDialogState {
    readonly canView: boolean
    readonly canUpdate: boolean
    readonly tab: MonitoringTab
    readonly id: string
    readonly locale: string
    readonly domains: readonly { value: string; label: string }[]
    readonly policy: HostMonitoringPolicyView | null
    readonly loading: boolean
    readonly error: boolean
    readonly historyError: boolean
    readonly historyLoading: boolean
    readonly observations: HostMonitoringHistoryView['observations']
    readonly incidents: HostMonitoringHistoryView['incidents']
    readonly status: HostMonitoringHistoryQuery['status']
    readonly period: MonitoringPeriod
    readonly more: boolean
    readonly capped: boolean
    readonly loadingMore: boolean
    readonly pending: boolean
    readonly dirty: boolean
    readonly valid: boolean
    readonly conflict: boolean
    readonly notice: string
    readonly ready: boolean
    readonly numericFields: readonly { name: NumericMonitoringSetting; min: number; max: number }[]
}
export interface MonitoringDialogHandler {
    readonly handleOpenChange: (open: boolean) => void
    readonly handleTab: (tab: MonitoringTab) => void
    readonly handleTabKey: (event: KeyboardEvent<HTMLButtonElement>) => void
    readonly handleRetry: () => void
    readonly handleStatus: (value: string | null) => void
    readonly handlePeriod: (value: string | null) => void
    readonly handleMore: () => void
    readonly handleReload: () => void
    readonly handleDiscard: () => void
    readonly handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void
    readonly formatDate: (date: Date | null) => string
}
