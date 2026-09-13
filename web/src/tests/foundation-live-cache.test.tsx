import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import type { FoundationHealth } from '../shared/Types/health.types'
import { foundationStatusQueryKeys } from '../features/FoundationStatus/queryKeys'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const freshHealth: FoundationHealth = {
    controller: { state: 'connected' },
    database: { state: 'connected' },
    redis: { state: 'connected' },
}
const staleHealth: FoundationHealth = {
    controller: { state: 'unavailable' },
    database: { state: 'unavailable' },
    redis: { state: 'unavailable' },
}

let resolveHealth: ((health: FoundationHealth) => void) | undefined
const getFoundationHealthHandlerMock = mock(
    () => new Promise<FoundationHealth>((resolve) => (resolveHealth = resolve)),
)

mock.module('../features/FoundationStatus/server', () => ({
    getFoundationHealthHandler: getFoundationHealthHandlerMock,
}))

const { default: FoundationStatusPage } = await import('../features/FoundationStatus')

class FakeSocket {
    static readonly OPEN = 1
    static instances: FakeSocket[] = []
    readonly readyState = 0
    private readonly listeners = new Set<(event: { data: string }) => void>()

    constructor(readonly url: URL) {
        FakeSocket.instances.push(this)
    }

    close() {
        this.listeners.clear()
    }

    addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'message') this.listeners.add(listener)
    }

    deliver(data: unknown) {
        const event = {
            data: JSON.stringify({
                type: 'snapshot',
                topic: 'foundation',
                query: {},
                payload: data,
            }),
        }
        this.listeners.forEach((listener) => listener(event))
    }
}

const originalSocket = globalThis.WebSocket
let root: Root | null = null
let queryClient: QueryClient | null = null

async function flush() {
    await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
    })
}

beforeEach(() => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: new URL('http://localhost:5173/'),
    })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
    FakeSocket.instances = []
    resolveHealth = undefined
    getFoundationHealthHandlerMock.mockClear()
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root?.unmount())
    queryClient?.clear()
    root = null
    queryClient = null
    document.body.replaceChildren()
    globalThis.WebSocket = originalSocket
    Reflect.deleteProperty(document, 'visibilityState')
})

test('keeps a live foundation snapshot when the initial HTTP response arrives late', async () => {
    await act(async () => {
        root?.render(
            withTestLanguage(
                <QueryClientProvider client={queryClient!}>
                    <FoundationStatusPage />
                </QueryClientProvider>,
            ),
        )
    })
    await flush()
    expect(getFoundationHealthHandlerMock).toHaveBeenCalledTimes(1)
    const socket = FakeSocket.instances[0]
    expect(socket).toBeDefined()
    const client = queryClient!

    await act(async () => socket?.deliver(freshHealth))
    await flush()
    expect(client.getQueryData<FoundationHealth>(foundationStatusQueryKeys.all)).toEqual(
        freshHealth,
    )
    await act(async () => resolveHealth?.(staleHealth))
    await flush()
    expect(client.getQueryData<FoundationHealth>(foundationStatusQueryKeys.all)).toEqual(
        freshHealth,
    )
})
