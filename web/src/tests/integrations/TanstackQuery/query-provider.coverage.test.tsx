import { expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import QueryProvider from '@/integrations/TanstackQuery/index.tsx'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')

test('query provider retains its cache across rerenders and isolates clients between mounted providers', async () => {
    const containers = [document.createElement('div'), document.createElement('div')]
    containers.forEach((container) => document.body.append(container))
    const roots = containers.map((container) => createRoot(container))
    const clients: QueryClient[] = []
    function Probe({ index }: { index: number }) {
        const client = useQueryClient()
        useEffect(() => {
            clients[index] = client
        }, [client, index])
        return null
    }
    try {
        await act(async () => {
            roots[0]!.render(
                <QueryProvider>
                    <Probe index={0} />
                </QueryProvider>,
            )
        })
        const first = clients[0]!
        first.setQueryData(['fixture'], { owner: 'first' })
        await act(async () => {
            roots[0]!.render(
                <QueryProvider>
                    <Probe index={0} />
                </QueryProvider>,
            )
        })
        expect(clients[0]).toBe(first)
        expect(clients[0]!.getQueryData(['fixture'])).toEqual({ owner: 'first' })
        expect(first.getDefaultOptions().queries).toMatchObject({
            staleTime: 30000,
            retry: 1,
            refetchOnWindowFocus: false,
        })
        await act(async () => {
            roots[1]!.render(
                <QueryProvider>
                    <Probe index={1} />
                </QueryProvider>,
            )
        })
        expect(clients[1]).not.toBe(first)
        expect(clients[1]!.getQueryData(['fixture'])).toBeUndefined()
    } finally {
        await act(async () => {
            roots.forEach((root) => root.unmount())
        })
        clients.forEach((client) => client.clear())
        containers.forEach((container) => container.remove())
    }
})
