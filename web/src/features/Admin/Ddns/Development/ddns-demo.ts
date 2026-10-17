import type { DdnsApi, DdnsResponse } from '../Types/ddns-ui.types.ts'
import type { DdnsBatch, DdnsDraft, DdnsSnapshot, DdnsTarget } from '@/lib/Ddns/Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import { ddnsDraftSchema } from '@/lib/Ddns/validation.ts'
import { activeDdnsTarget, ddnsDraft } from '@/lib/Ddns/targets.ts'

const id = (number: number) => `0199e800-0000-7000-8000-${String(number).padStart(12, '0')}`
const actorId = id(1)
const zoneId = 'a'.repeat(32)
const ipv4 = '203.0.113.42'
const ipv6 = '2001:db8::42'

function connections(): DnsConnection[] {
    return ['Cloudflare · Demo', 'Cloudflare · Services'].map((name, index) => ({
        id: id(index + 2),
        provider: 'cloudflare',
        ownership: 'instance',
        name,
        createdByUserId: actorId,
        revision: 1,
        zones: [
            { id: zoneId, name: 'example.com' },
            { id: 'b'.repeat(32), name: 'example.org' },
        ],
        references: [],
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
    }))
}

function snapshot(
    draft: DdnsDraft,
    enabled: boolean,
    revision: number,
    previous?: DdnsSnapshot,
): DdnsSnapshot {
    const now = Math.floor(Date.now() / 1000)
    return {
        version: 1,
        configuration: { revision, updatedByUserId: actorId, settings: { ...draft, enabled } },
        targets: draft.targets.map((target) => {
            const retained = previous?.targets.find((state) => state.targetId === target.id)
            return {
                targetId: target.id,
                lastAttemptAt: null,
                lastSuccessAt: null,
                lastSuccessfulAddress: null,
                lastSuccessfulProxied: null,
                lastResult: null,
                consecutiveFailures: 0,
                permanentFailure: false,
                connectionRevision: null,
                retryNotBefore: null,
                ...retained,
                nextAttemptAt:
                    enabled && activeDdnsTarget(draft, target) && !retained?.permanentFailure
                        ? Math.max(retained?.retryNotBefore ?? 0, now + draft.intervalSeconds)
                        : null,
            }
        }),
        inFlight: null,
        lastRun: previous?.lastRun ?? null,
        providerNotBefore: null,
        providerPauseReason: null,
        manualNotBefore: null,
        restorePaused: false,
        events: [],
        eventSequence: 0,
    }
}

function initialSnapshot(): DdnsSnapshot {
    const names = [
        'example.com',
        '*.example.com',
        'git.example.com',
        'cloud.example.com',
        'vpn.example.com',
        'test.example.com',
        'status.example.com',
        'example.org',
        'media.example.org',
        'backup.example.org',
        'home.example.org',
        'mail.example.org',
    ]
    const targets: DdnsTarget[] = names.map((name, index) => ({
        id: id(index + 10),
        connectionId: id(index < 7 ? 2 : 3),
        zoneId: name.endsWith('example.org') ? 'b'.repeat(32) : zoneId,
        name,
        recordType: [3, 8, 10].includes(index) ? 'AAAA' : 'A',
        proxied: ![2, 4, 9, 11].includes(index),
        enabled: ![5, 9].includes(index),
        selection: { mode: 'adopt', recordId: (index + 1).toString(16).padStart(32, '0') },
    }))
    const value = snapshot(
        { intervalSeconds: 300, updateOnStart: true, ipv4: true, ipv6: true, targets },
        true,
        1,
    )
    const now = Math.floor(Date.now() / 1000)
    value.targets = value.targets.map((state, index) => {
        const target = targets[index]!
        const failed = [4, 6].includes(index)
        const address = target.recordType === 'A' ? ipv4 : ipv6
        return {
            ...state,
            lastAttemptAt: now - 65,
            lastSuccessAt: now - (failed ? 365 : 65),
            lastSuccessfulAddress: address,
            lastSuccessfulProxied: target.proxied,
            lastResult: {
                targetId: target.id,
                status: failed ? 'failed' : index % 3 === 0 ? 'updated' : 'unchanged',
                current: {
                    id: (index + 1).toString(16).padStart(32, '0'),
                    address,
                    proxied: target.proxied,
                },
                desiredAddress: address,
                error:
                    index === 4 ? 'provider_unavailable' : index === 6 ? 'record_conflict' : null,
                retryAfterSeconds: index === 4 ? 60 : null,
            },
            consecutiveFailures: failed ? 1 : 0,
            permanentFailure: index === 6,
            connectionRevision: 1,
            nextAttemptAt: !target.enabled || index === 6 ? null : now + (index === 4 ? 60 : 235),
            retryNotBefore: index === 4 ? now + 60 : null,
        }
    })
    value.lastRun = {
        startedAt: now - 70,
        finishedAt: now - 65,
        actorUserId: actorId,
        trigger: 'scheduled',
        outcome: 'partial_failure',
        updated: 3,
        failed: 2,
    }
    return value
}

function success<T>(result: T): DdnsResponse<T> {
    return { success: true, value: structuredClone(result) }
}

function failure(message = 'admin.ddns.errors.invalid_input') {
    return { success: false as const, message }
}

export function createDdnsDemoApi(): DdnsApi {
    // This adapter has no transport or controller dependency. Every operation stays in memory.
    let value = initialSnapshot()
    const matches = (revision: number) => value.configuration?.revision === revision
    const apply = async (draft: DdnsDraft, enabled: boolean, revision: number) => {
        if (!matches(revision)) return failure('admin.ddns.errors.conflict')
        const parsed = ddnsDraftSchema.safeParse(draft)
        if (!parsed.success) return failure()
        const permitted = connections()
        if (
            parsed.data.targets.some(
                (target) =>
                    !permitted.some(
                        (connection) =>
                            connection.id === target.connectionId &&
                            connection.zones.some(
                                (zone) =>
                                    zone.id === target.zoneId &&
                                    (target.name === zone.name ||
                                        target.name.endsWith(`.${zone.name}`)),
                            ),
                    ),
            )
        )
            return failure('admin.ddns.validation.zone')
        value = snapshot(parsed.data, enabled, revision + 1, value)
        return success(value)
    }
    return {
        status: async () => structuredClone(value),
        connections: async () => connections(),
        apply: async (input) => apply(input.draft, input.enabled, input.expectedRevision),
        save: async (input) => apply(input.draft, false, input.expectedRevision),
        enable: async (input) =>
            apply(ddnsDraft(value.configuration!.settings), true, input.expectedRevision),
        disable: async (input) =>
            apply(ddnsDraft(value.configuration!.settings), false, input.expectedRevision),
        preview: async () => failure(),
        sync: async (input) => {
            if (!matches(input.expectedRevision)) return failure('admin.ddns.errors.conflict')
            const settings = value.configuration!.settings
            if (!settings.enabled) return failure()
            const now = Math.floor(Date.now() / 1000)
            const batch: DdnsBatch = {
                preview: false,
                ipv4: settings.ipv4 ? ipv4 : null,
                ipv6: settings.ipv6 ? ipv6 : null,
                targets: settings.targets.map((target) => {
                    const state = value.targets.find((entry) => entry.targetId === target.id)!
                    const address = target.recordType === 'A' ? ipv4 : ipv6
                    const paused = !activeDdnsTarget(settings, target)
                    return {
                        targetId: target.id,
                        status: paused
                            ? 'skipped'
                            : state.permanentFailure
                              ? 'failed'
                              : 'unchanged',
                        current: {
                            id:
                                target.selection.mode === 'adopt'
                                    ? target.selection.recordId
                                    : 'c'.repeat(32),
                            address,
                            proxied: target.proxied,
                        },
                        desiredAddress: paused ? null : address,
                        error: paused
                            ? 'target_disabled'
                            : state.permanentFailure
                              ? 'record_conflict'
                              : null,
                        retryAfterSeconds: null,
                    }
                }),
            }
            value.targets = value.targets.map((state) => {
                const result = batch.targets.find((target) => target.targetId === state.targetId)!
                if (result.status !== 'unchanged') return state
                return {
                    ...state,
                    lastAttemptAt: now,
                    lastSuccessAt: now,
                    lastSuccessfulAddress: result.current!.address,
                    lastSuccessfulProxied: result.current!.proxied,
                    lastResult: result,
                    consecutiveFailures: 0,
                    retryNotBefore: null,
                    nextAttemptAt: now + settings.intervalSeconds,
                }
            })
            value.lastRun = {
                startedAt: now,
                finishedAt: now,
                actorUserId: actorId,
                trigger: 'manual',
                outcome: batch.targets.some((target) => target.status === 'failed')
                    ? 'partial_failure'
                    : 'completed',
                updated: 0,
                failed: batch.targets.filter((target) => target.status === 'failed').length,
            }
            return success(batch)
        },
    }
}
