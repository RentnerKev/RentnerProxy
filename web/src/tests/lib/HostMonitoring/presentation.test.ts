import { describe, expect, test } from 'bun:test'
import { durationSeries, monitoringSince } from '@/lib/HostMonitoring/presentation.ts'

describe('monitoring presentation', () => {
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
