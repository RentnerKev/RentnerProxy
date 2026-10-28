import { describe, expect, test } from 'bun:test'
import { durationPlot, monitoringSince } from '@/lib/HostMonitoring/presentation.ts'

describe('monitoring presentation', () => {
    test('time filters are explicit UTC bounds and recent has no bound', () => {
        const now = Date.parse('2026-10-29T12:00:00.000Z')
        expect(monitoringSince('recent', now)).toBeUndefined()
        expect(monitoringSince('hour', now)).toBe('2026-10-29T11:00:00.000Z')
        expect(monitoringSince('day', now)).toBe('2026-10-28T12:00:00.000Z')
        expect(monitoringSince('week', now)).toBe('2026-10-22T12:00:00.000Z')
    })
    test('chart orders observations, scales actual elapsed time and breaks at unknown evidence', () => {
        const samples = [
            { checkedAt: new Date(3000), durationMs: 100, status: 'healthy' },
            { checkedAt: new Date(0), durationMs: 50, status: 'healthy' },
            { checkedAt: new Date(1000), durationMs: null, status: 'unknown' },
        ]
        const plot = durationPlot(samples)
        expect(plot.paths).toEqual(['M10.0,60.0', 'M590.0,10.0'])
        expect(plot.points).toEqual([
            { x: 10, y: 60, key: '0-0' },
            { x: 590, y: 10, key: '3000-1' },
        ])
        expect(plot.maximum).toBe(100)
        expect(samples[0]?.checkedAt.getTime()).toBe(3000)
    })
    test('empty and zero-duration samples never produce invalid SVG coordinates', () => {
        expect(durationPlot([])).toEqual({
            paths: [],
            points: [],
            maximum: 1,
            first: null,
            last: null,
        })
        expect(
            durationPlot([{ checkedAt: new Date(0), durationMs: 0, status: 'healthy' }]).paths,
        ).toEqual(['M10.0,110.0'])
        expect(
            durationPlot([{ checkedAt: new Date(0), durationMs: 0, status: 'healthy' }]).points,
        ).toEqual([{ x: 10, y: 110, key: '0-0' }])
    })
})
