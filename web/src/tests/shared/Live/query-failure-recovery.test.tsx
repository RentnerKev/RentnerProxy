import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import useQueryFailureRecovery from '@/shared/Live/Hooks/useQueryFailureRecovery.ts'
import { LIVE_READ_RETRY_INITIAL_MS, LIVE_READ_RETRY_MAX_MS } from '@/config/realtime.config.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement
let client: QueryClient
let read: ReturnType<typeof mock<() => Promise<string>>>
const queryKey = ['query-failure-recovery', 'http-read']
const isWebSocketOwned = (key: ReadonlyArray<unknown>) => key[0] === 'websocket-owned'
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
let timerSpy: ReturnType<typeof spyOn<typeof globalThis, 'setTimeout'>>
let clearTimerSpy: ReturnType<typeof spyOn<typeof globalThis, 'clearTimeout'>>
let now = 0
const timers = new Map<unknown, { at: number; callback: () => void }>()

function Probe({
    enabled = true,
    active = true,
    scope = 0,
    owned = false,
}: {
    enabled?: boolean
    active?: boolean
    scope?: number
    owned?: boolean
}) {
    useQueryFailureRecovery(enabled, scope, isWebSocketOwned)
    const query = useQuery({
        queryKey: owned ? ['websocket-owned', 'snapshot'] : queryKey,
        queryFn: read,
        enabled: active,
    })
    return <output>{query.data ?? query.status}</output>
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => realSetTimeout(resolve, 0))
        await new Promise((resolve) => realSetTimeout(resolve, 0))
    })
}

async function render(props: Parameters<typeof Probe>[0] = {}) {
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client}>
                <Probe {...props} />
            </QueryClientProvider>,
        )
    })
    await flush()
}

async function advance(milliseconds: number) {
    const target = now + milliseconds
    let next = [...timers.entries()].find(([, timer]) => timer.at <= target)
    while (next) {
        const [handle, timer] = next
        now = timer.at
        timers.delete(handle)
        // oxlint-disable-next-line no-await-in-loop -- Settle each retry before advancing the next deterministic deadline.
        await act(async () => timer.callback())
        // oxlint-disable-next-line no-await-in-loop -- Query cache notifications schedule the following retry.
        await flush()
        next = [...timers.entries()].find(([, scheduled]) => scheduled.at <= target)
    }
    now = target
    await flush()
}

beforeEach(() => {
    now = 0
    timers.clear()
    const schedule = (
        ...parameters: Parameters<typeof setTimeout>
    ): ReturnType<typeof setTimeout> => {
        const [callback, delay, ...args] = parameters
        if (
            typeof callback === 'function' &&
            delay !== undefined &&
            delay >= LIVE_READ_RETRY_INITIAL_MS &&
            delay <= LIVE_READ_RETRY_MAX_MS
        ) {
            const handle = {} as ReturnType<typeof setTimeout>
            timers.set(handle, { at: now + delay, callback: () => callback(...args) })
            return handle
        }
        return realSetTimeout(callback, delay, ...args)
    }
    timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(schedule as typeof setTimeout)
    clearTimerSpy = spyOn(globalThis, 'clearTimeout').mockImplementation((handle) => {
        if (handle !== undefined && timers.delete(handle)) return
        realClearTimeout(handle as ReturnType<typeof setTimeout>)
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    client = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: Infinity,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
            },
        },
    })
    read = mock(async () => {
        throw new Error('Failed to fetch')
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    client.clear()
    container.remove()
    timerSpy.mockRestore()
    clearTimerSpy.mockRestore()
    timers.clear()
    Reflect.deleteProperty(document, 'visibilityState')
    Reflect.deleteProperty(navigator, 'onLine')
})

test('automatically recovers a failed active HTTP read without a button or WebSocket event', async () => {
    read.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue('recovered data')
    await render()
    expect(read).toHaveBeenCalledTimes(1)
    expect(client.getQueryState(queryKey)?.status).toBe('error')
    await advance(LIVE_READ_RETRY_INITIAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('recovered data')
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    expect(read).toHaveBeenCalledTimes(2)
})

test('backs off repeated failures up to the configured cap with one scheduled retry', async () => {
    await render()
    let calls = 1
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
        // oxlint-disable-next-line no-await-in-loop -- Each failure must settle before checking the next backoff interval.
        await advance(delay - 1)
        expect(read).toHaveBeenCalledTimes(calls)
        // oxlint-disable-next-line no-await-in-loop -- Advance the final millisecond of this retry's interval.
        await advance(1)
        expect(read).toHaveBeenCalledTimes(++calls)
    }
})

test('resume events do not start duplicate HTTP reads while recovery is in flight', async () => {
    const pending = Promise.withResolvers<string>()
    read.mockRejectedValueOnce(new Error('Failed to fetch')).mockReturnValue(pending.promise)
    await render()
    await advance(LIVE_READ_RETRY_INITIAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => {
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('online'))
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => pending.resolve('finished'))
    await flush()
    expect(container.textContent).toBe('finished')
})

test.each([401, 403, 404])('does not retry an HTTP %s failure', async (status) => {
    read.mockRejectedValue(Object.assign(new Error('Read denied'), { status }))
    await render()
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    await act(async () => window.dispatchEvent(new Event('online')))
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
})

test('leaves WebSocket-owned queries to their existing recovery mechanism', async () => {
    await render({ owned: true })
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    await act(async () => window.dispatchEvent(new Event('focus')))
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
})

test('cancels scheduled retries when the query becomes inactive', async () => {
    await render()
    await render({ active: false })
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    await act(async () => window.dispatchEvent(new Event('online')))
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
})

test('identity suspension and unmount cancel timers and remove resume listeners', async () => {
    await render()
    await render({ enabled: false })
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(read).toHaveBeenCalledTimes(1)
    await render({ enabled: true })
    await act(async () => root!.unmount())
    root = undefined
    await advance(LIVE_READ_RETRY_MAX_MS * 2)
    await act(async () => window.dispatchEvent(new Event('online')))
    expect(read).toHaveBeenCalledTimes(1)
})

test('a new identity scope discards the old timer and resets its retry delay', async () => {
    await render()
    await advance(LIVE_READ_RETRY_INITIAL_MS)
    expect(read).toHaveBeenCalledTimes(2)
    await advance(LIVE_READ_RETRY_INITIAL_MS / 2)
    await render({ scope: 1 })
    await advance(LIVE_READ_RETRY_INITIAL_MS - 1)
    expect(read).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(read).toHaveBeenCalledTimes(3)
    await render({ enabled: false, scope: 1 })
    await advance(LIVE_READ_RETRY_MAX_MS)
    expect(read).toHaveBeenCalledTimes(3)
})

test.each(['online', 'focus', 'visibilitychange'])(
    '%s resumes a failed read when the page becomes available',
    async (event) => {
        read.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue('resumed data')
        await render()
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        await advance(LIVE_READ_RETRY_INITIAL_MS)
        expect(read).toHaveBeenCalledTimes(1)
        await act(async () => {
            const target = event === 'visibilitychange' ? document : window
            target.dispatchEvent(new Event(event))
        })
        expect(read).toHaveBeenCalledTimes(1)
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
        await act(async () => {
            const target = event === 'visibilitychange' ? document : window
            target.dispatchEvent(new Event(event))
        })
        await flush()
        expect(read).toHaveBeenCalledTimes(2)
        expect(container.textContent).toBe('resumed data')
    },
)
