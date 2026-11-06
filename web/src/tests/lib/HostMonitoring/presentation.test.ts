import { describe, expect, test } from 'bun:test'
import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import {
    durationSeries,
    monitoringCheckSlots,
    monitoringSince,
} from '@/lib/HostMonitoring/presentation.ts'

describe('monitoring presentation', () => {
    test('check slots reserve missing history and place chronological measurements at the right', () => {
        const latest = { id: 'latest', checkedAt: new Date(3000), status: 'healthy' }
        const oldest = { id: 'oldest', checkedAt: new Date(1000), status: 'unhealthy' }
        const samples = [latest, oldest]
        const slots = monitoringCheckSlots(samples)
        expect(slots).toHaveLength(HOST_MONITORING_UI.historySlots)
        expect(slots.slice(0, -2).every((slot) => slot.observation === null)).toBe(true)
        expect(slots.slice(-2).map((slot) => slot.observation)).toEqual([oldest, latest])
        expect(samples).toEqual([latest, oldest])
        const empty = monitoringCheckSlots([])
        expect(empty).toHaveLength(HOST_MONITORING_UI.historySlots)
        expect(empty.every((slot) => slot.observation === null)).toBe(true)
        expect(new Set(empty.map((slot) => slot.id)).size).toBe(empty.length)
    })
    test('a full strip keeps only the latest measurements without placeholders', () => {
        const samples = Array.from({ length: HOST_MONITORING_UI.historySlots + 5 }, (_, index) => ({
            id: `check-${index}`,
            checkedAt: new Date(index * 1000),
        })).toReversed()
        const slots = monitoringCheckSlots(samples)
        expect(slots.map((slot) => slot.observation)).toEqual(samples.toReversed().slice(5))
        expect(slots).toHaveLength(HOST_MONITORING_UI.historySlots)
    })
    test('time filters are explicit UTC bounds and recent has no bound', () => {
        const now = Date.parse('2026-10-29T12:00:00.000Z')
        expect(monitoringSince('recent', now)).toBeUndefined()
        expect(monitoringSince('hour', now)).toBe('2026-10-29T11:00:00.000Z')
        expect(monitoringSince('day', now)).toBe('2026-10-28T12:00:00.000Z')
        expect(monitoringSince('week', now)).toBe('2026-10-22T12:00:00.000Z')
    })
    test('chart data is chronological and unknown evidence stays missing without changing inputs', () => {
        const samples = [
            { checkedAt: new Date(3000), durationMs: 100, status: 'healthy' },
            { checkedAt: new Date(0), durationMs: 50, status: 'healthy' },
            { checkedAt: new Date(1000), durationMs: 75, status: 'unknown' },
        ]
        expect(durationSeries(samples)).toEqual([
            { checkedAt: new Date(0), durationMs: 50, status: 'healthy' },
            { checkedAt: new Date(1000), durationMs: null, status: 'unknown' },
            { checkedAt: new Date(3000), durationMs: 100, status: 'healthy' },
        ])
        expect(samples[0]?.checkedAt.getTime()).toBe(3000)
        expect(samples[2]?.durationMs).toBe(75)
    })
    test('empty data and a measured zero remain distinct', () => {
        expect(durationSeries([])).toEqual([])
        const zero = { checkedAt: new Date(0), durationMs: 0, status: 'healthy' }
        expect(durationSeries([zero])).toEqual([zero])
    })
})
