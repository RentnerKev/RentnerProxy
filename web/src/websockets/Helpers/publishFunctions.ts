import type { ApplicationChangedEvent } from '../Types/events'

type ChangeListener = () => void
type ChangePublisher = (event: ApplicationChangedEvent) => Promise<unknown>

declare global {
    var rentnerproxyRealtimeEvents:
        | {
              version: string
              listeners: Set<ChangeListener>
              seen: Set<string>
              publish: ChangePublisher | undefined
          }
        | undefined
}

function getEvents() {
    return (globalThis.rentnerproxyRealtimeEvents ??= {
        version: crypto.randomUUID(),
        listeners: new Set(),
        seen: new Set(),
        publish: undefined,
    })
}

export function receiveApplicationChange(event: ApplicationChangedEvent): void {
    const events = getEvents()
    if (events.seen.has(event.payload.version)) return
    events.seen.add(event.payload.version)
    if (events.seen.size > 256) events.seen.delete(events.seen.values().next().value!)
    events.version = event.payload.version
    for (const listener of events.listeners) {
        try {
            listener()
        } catch {
            continue
        }
    }
}

export function publishApplicationChange(): void {
    const event: ApplicationChangedEvent = {
        type: 'application.updated',
        payload: { version: crypto.randomUUID() },
    }
    receiveApplicationChange(event)
    try {
        void getEvents()
            .publish?.(event)
            .catch(() => undefined)
    } catch {
        return
    }
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
