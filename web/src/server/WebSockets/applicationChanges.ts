import type { ChangeListener, ChangePublisher } from './Types/application-changes.types.ts'
import type { ApplicationChangedEvent } from '@/lib/Live/Types/events.types.ts'
import { LIVE_CHANGE_COALESCE_MS } from '@/config/realtime.config.ts'

declare global {
    var rentnerproxyRealtimeEvents:
        | {
              version: string
              listeners: Set<ChangeListener>
              seen: Set<string>
              publish: ChangePublisher | undefined
              notificationTimer: ReturnType<typeof setTimeout> | undefined
              publishTimer: ReturnType<typeof setTimeout> | undefined
              pendingPublication: ApplicationChangedEvent | undefined
          }
        | undefined
}

function getEvents() {
    return (globalThis.rentnerproxyRealtimeEvents ??= {
        version: crypto.randomUUID(),
        listeners: new Set(),
        seen: new Set(),
        publish: undefined,
        notificationTimer: undefined,
        publishTimer: undefined,
        pendingPublication: undefined,
    })
}

export function receiveApplicationChange(event: ApplicationChangedEvent): void {
    const events = getEvents()
    if (events.seen.has(event.payload.version)) return
    events.seen.add(event.payload.version)
    if (events.seen.size > 256) events.seen.delete(events.seen.values().next().value!)
    events.version = event.payload.version
    if (events.notificationTimer === undefined) {
        events.notificationTimer = setTimeout(() => {
            events.notificationTimer = undefined
            for (const listener of events.listeners) {
                try {
                    listener()
                } catch {
                    continue
                }
            }
        }, LIVE_CHANGE_COALESCE_MS)
        events.notificationTimer.unref?.()
    }
}

function schedulePublication(event: ApplicationChangedEvent): void {
    const events = getEvents()
    events.pendingPublication = event
    if (events.publishTimer !== undefined) return
    events.publishTimer = setTimeout(() => {
        events.publishTimer = undefined
        const pending = events.pendingPublication
        events.pendingPublication = undefined
        if (!pending) return
        try {
            void events.publish?.(pending).catch(() => undefined)
        } catch {
            return
        }
    }, LIVE_CHANGE_COALESCE_MS)
    events.publishTimer.unref?.()
}

export function publishApplicationChange(): void {
    const event: ApplicationChangedEvent = {
        type: 'application.updated',
        payload: { version: crypto.randomUUID() },
    }
    receiveApplicationChange(event)
    schedulePublication(event)
}

export function setApplicationPublisher(publish: ChangePublisher | undefined): void {
    getEvents().publish = publish
}

export function subscribeToApplicationChanges(listener: ChangeListener): () => void {
    getEvents().listeners.add(listener)
    return () => {
        getEvents().listeners.delete(listener)
    }
}

export function getApplicationRevision(): string {
    return getEvents().version
}
