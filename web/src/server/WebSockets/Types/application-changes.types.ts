import type { ApplicationChangedEvent } from '@/lib/Live/Types/events.types.ts'

export type ChangeListener = () => void

export type ChangePublisher = (event: ApplicationChangedEvent) => Promise<unknown>
