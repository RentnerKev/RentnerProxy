import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let fail = false
mock.module('@/features/ApplicationVersion/middleware.ts', () => ({
    getApplicationUpdateHandler: async () => {
        if (fail) throw new Error('offline')
        return { status: 'available', latest: { image: { status: 'verified' } } }
    },
}))
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: useApplicationUpdateQuery } =
    await import('@/features/ApplicationVersion/Hooks/useApplicationUpdateQuery.ts')
let root: Root | null = null
let client: QueryClient | null = null
function Harness() {
    const data = useApplicationUpdateQuery()
    return (
        <output
            data-status={data?.status}
            data-checked-at={data?.checkedAt ?? ''}
            data-has-latest={String(data?.latest !== null && data?.latest !== undefined)}
        >
            {data?.latest?.image.status ?? 'unavailable'}
        </output>
    )
}
afterEach(async () => {
    await act(async () => root?.unmount())
    client?.clear()
    document.body.replaceChildren()
    fail = false
})

test('five-minute polling clears previous verified data when refetch fails', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    client = new QueryClient()
    await act(async () => {
        root!.render(
            <QueryClientProvider client={client!}>
                <Harness />
            </QueryClientProvider>,
        )
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
    expect(container.textContent).toBe('verified')
    const query = client.getQueryCache().find({ queryKey: ['application-update'] })!
    expect((query.options as { refetchInterval?: number }).refetchInterval).toBe(5 * 60 * 1000)
    fail = true
    await act(async () => {
        await client!.refetchQueries({ queryKey: ['application-update'] })
        await new Promise((resolve) => setTimeout(resolve, 15))
    })
    expect(container.textContent).toBe('unavailable')
    expect(container.querySelector('output')?.dataset.status).toBe('unavailable')
    expect(container.querySelector('output')?.dataset.checkedAt).toBe('')
    expect(container.querySelector('output')?.dataset.hasLatest).toBe('false')
})
