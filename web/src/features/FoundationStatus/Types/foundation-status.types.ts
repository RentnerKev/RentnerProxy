import type { FoundationHealth } from '../../../shared/Types/health.types'

export interface FoundationStatusProps {
    readonly health: FoundationHealth
    readonly compact?: boolean
}

export interface ConnectionTraceProps {
    readonly connected: boolean
}

export type ServiceStatusTone = 'positive' | 'warning'

export interface ServiceStatusProps {
    readonly detail: string
    readonly label: string
    readonly tone: ServiceStatusTone
    readonly value: string
}

export interface FoundationStatusViewModel {
    readonly controllerConnected: boolean
    readonly services: readonly ServiceStatusProps[]
}

export type FoundationStatusViewProps = FoundationStatusViewModel
