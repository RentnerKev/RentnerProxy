import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

export async function flushHook() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

export async function mountHook<T>(hook: () => T) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    let current: T | undefined
    function Probe() {
        current = hook()
        return null
    }
    await act(async () => {
        root.render(createElement(QueryClientProvider, { client }, createElement(Probe)))
    })
    await flushHook()
    return {
        client,
        get value(): T {
            if (current === undefined) throw new Error('Hook did not render')
            return current
        },
        async run<R>(callback: () => R | Promise<R>): Promise<R> {
            let result: R | undefined
            await act(async () => {
                result = await callback()
            })
            await flushHook()
            return result as R
        },
        async dispose() {
            await act(async () => {
                root.unmount()
            })
            client.clear()
            container.remove()
        },
    }
}
