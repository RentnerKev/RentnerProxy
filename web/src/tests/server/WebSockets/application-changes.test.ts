import { afterEach, expect, mock, test } from 'bun:test'

import { LIVE_CHANGE_COALESCE_MS } from '@/config/realtime.config.ts'
import {
    getApplicationRevision,
    publishApplicationChange,
    receiveApplicationChange,
    setApplicationPublisher,
    subscribeToApplicationChanges,
} from '@/server/WebSockets/applicationChanges.ts'

afterEach(() => {
    const events = globalThis.rentnerproxyRealtimeEvents
    if (events?.notificationTimer) clearTimeout(events.notificationTimer)
    if (events?.publishTimer) clearTimeout(events.publishTimer)
    globalThis.rentnerproxyRealtimeEvents = undefined
})

test('coalesces committed changes into one publication and one sampling notification', async () => {
    const publisher = mock(async () => undefined)
    const listener = mock(() => undefined)
    setApplicationPublisher(publisher)
    const unsubscribe = subscribeToApplicationChanges(listener)
    for (let count = 0; count < 100; count += 1) publishApplicationChange()
    const latest = getApplicationRevision()
    expect(publisher).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
    expect(publisher).toHaveBeenCalledTimes(1)
    expect(publisher).toHaveBeenCalledWith({
        type: 'application.updated',
        payload: { version: latest },
    })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
})

test('coalesces remote event storms and deduplicates their echoed versions', async () => {
    const listener = mock(() => undefined)
    subscribeToApplicationChanges(listener)
    for (let count = 0; count < 100; count += 1) {
        const event = {
            type: 'application.updated' as const,
            payload: { version: `remote-${count}` },
        }
        receiveApplicationChange(event)
        receiveApplicationChange(event)
    }
    await new Promise((resolve) => setTimeout(resolve, LIVE_CHANGE_COALESCE_MS + 30))
    expect(getApplicationRevision()).toBe('remote-99')
    expect(listener).toHaveBeenCalledTimes(1)
})
