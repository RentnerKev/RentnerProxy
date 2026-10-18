export type WorkerLifecycle = {
    start: () => void
    stop: () => Promise<void>
}
