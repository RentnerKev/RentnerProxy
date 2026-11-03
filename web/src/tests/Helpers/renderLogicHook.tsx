// oxlint-disable no-await-in-loop -- Bounded React state observations must settle sequentially.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import withTestLanguage from './withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')

export default async function renderLogicHook<T>(
    useLogic: () => T,
    render?: (value: T) => ReactNode,
) {
    let value: T | undefined
    function Probe() {
        const result = useLogic()
        useLayoutEffect(() => {
            value = result
        })
        return render?.(result) ?? null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const current = (): T => {
        if (value === undefined) throw new Error('Hook has not rendered')
        return value
    }
    const run = async (action: (result: T) => unknown) => {
        await act(async () => {
            await action(current())
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
    await act(async () => {
        root.render(
            withTestLanguage(
                <QueryClientProvider client={client}>
                    <Probe />
                </QueryClientProvider>,
            ),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
    return {
        client,
        container,
        get current() {
            return current()
        },
        run,
        async waitFor(predicate: (result: T) => boolean) {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (predicate(current())) return
                await run(() => new Promise((resolve) => setTimeout(resolve, 5)))
            }
            throw new Error('Hook state did not converge')
        },
        async dispose() {
            await act(async () => root.unmount())
            client.clear()
            container.remove()
        },
    }
}
