import {
    AUDIT_ACTIONS,
    AUDIT_RESOURCES,
    type AuditEventDto,
    type AuditMetadata,
    type AuditEventsQuery,
} from '../../../../shared/Types/audit-events.types'
import type { AuditLogsFilterErrors, AuditLogsFilters } from '../Types/audit-logs.types'

export const AUDIT_LOGS_PAGE_SIZE = 100

export const emptyAuditLogsFilters: AuditLogsFilters = {
    actorUserId: '',
    action: '',
    resource: '',
    from: '',
    to: '',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u

export function isUuid(value: string): boolean {
    return UUID_PATTERN.test(value.trim())
}

function dateBoundary(value: string, endOfMinute: boolean): string | undefined {
    const match = DATE_TIME_PATTERN.exec(value)
    if (!match) return undefined
    const [, year, month, day, hour, minute] = match
    const date = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${endOfMinute ? '59.999' : '00.000'}Z`,
    )
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== value) {
        return undefined
    }
    return date.toISOString()
}

export function toAuditEventsQuery(
    filters: AuditLogsFilters,
    cursor: string | undefined,
): AuditEventsQuery {
    const actorUserId = filters.actorUserId.trim()
    const from = filters.from ? dateBoundary(filters.from, false) : undefined
    const to = filters.to ? dateBoundary(filters.to, true) : undefined

    return {
        ...(actorUserId ? { actorUserId } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.resource ? { resource: filters.resource } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(cursor ? { cursor } : {}),
        limit: AUDIT_LOGS_PAGE_SIZE,
    }
}

export function validateAuditLogsFilters(filters: AuditLogsFilters): AuditLogsFilterErrors {
    const errors: AuditLogsFilterErrors = {}
    const actorUserId = filters.actorUserId.trim()
    if (actorUserId && !isUuid(actorUserId)) {
        errors.actorUserId = 'admin.auditLogs.validation.actorUserId'
    }

    if (filters.from && !dateBoundary(filters.from, false)) {
        errors.from = 'admin.auditLogs.validation.dateTime'
    }
    if (filters.to && !dateBoundary(filters.to, true)) {
        errors.to = 'admin.auditLogs.validation.dateTime'
    }
    if (filters.from && filters.to && !errors.from && !errors.to) {
        const from = dateBoundary(filters.from, false)
        const to = dateBoundary(filters.to, true)
        if (from && to && from > to) {
            errors.dateRange = 'admin.auditLogs.validation.dateRange'
        }
    }
    return errors
}

export const auditActionValues = AUDIT_ACTIONS

export const auditResourceValues = AUDIT_RESOURCES

const metadataKeys: readonly (keyof AuditMetadata)[] = [
    'authenticationMethod',
    'reason',
    'failureCode',
    'changedFields',
    'assigned',
    'previousId',
    'nextId',
    'runtimeStatus',
    'count',
]

export interface AuditMetadataEntry {
    readonly key: keyof AuditMetadata
    readonly value: string
}

export function getAuditMetadataEntries(metadata: AuditMetadata): AuditMetadataEntry[] {
    return metadataKeys.flatMap((key) => {
        const value = metadata[key]
        if (value === undefined) return []
        if (Array.isArray(value)) {
            return [{ key, value: value.join(', ') || '—' }]
        }
        if (value === null) return [{ key, value: '—' }]
        return [{ key, value: String(value) }]
    })
}

export function auditEventKey(event: AuditEventDto): string {
    return event.id
}

export function formatAuditActor(event: AuditEventDto): string {
    return event.actorDisplayName ?? event.actorUserId ?? event.actorKind
}

export function sortAuditEventsNewestFirst(events: readonly AuditEventDto[]): AuditEventDto[] {
    return events
        .map((event, index) => ({ event, index }))
        .toSorted((left, right) => {
            const rightTimestamp = Date.parse(right.event.timestamp)
            const leftTimestamp = Date.parse(left.event.timestamp)
            if (rightTimestamp !== leftTimestamp) return rightTimestamp - leftTimestamp
            return left.index - right.index
        })
        .map(({ event }) => event)
}

export const resultClassName = (result: AuditEventDto['result']) => {
    switch (result) {
        case 'success':
            return 'border-brand-600/20 bg-success-bg text-success-text'
        case 'denied':
            return 'border-amber-500/25 bg-amber-500/10 text-amber-700'
        default:
            return 'border-red-500/25 bg-danger-bg text-danger-text'
    }
}
