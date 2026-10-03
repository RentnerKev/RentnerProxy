import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import type { AccentColorUpdateResult } from '@/features/UserSettings/Types/appearance-server-result.types.ts'
import { AccentContext } from '@/shared/Theme/accentContext.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const USER_ID = '6f355778-511f-467b-ad8f-8c4a29b84510'
const ACCENT_CONTEXT = { accentColor: '#3366cc' }
const savedColor: AccentColorUpdateResult = {
    success: true,
    userId: USER_ID,
    accentColor: '#abcdef',
}
const updateAccent = mock(
    (_request: {
        data: { expectedUserId: string; accentColor: string | null }
    }): Promise<AccentColorUpdateResult> => Promise.resolve(savedColor),
)
const successToast = mock((_message: string, _options: { title: string }) => undefined)
const errorToast = mock((_message: string, _options: { title: string }) => undefined)

mock.module('@/features/UserSettings/middleware.ts', () => ({
    updateCurrentUserAccentColorHandler: updateAccent,
}))
mock.module('@rentnerkev/toasts/toast', () => ({
    toast: { success: successToast, error: errorToast },
}))

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } =
    await import('@tanstack/react-router')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useUserAppearancePanelLogic } =
    await import('@/features/UserSettings/Components/UserAppearancePanel/Hooks/useUserAppearancePanelLogic.ts')

const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
})
const invalidate = spyOn(router, 'invalidate')
let activeRoot: Root | null = null
let queryClient: InstanceType<typeof QueryClient> | null = null

function AppearanceProbe() {
    const { state, handler, setter } = useUserAppearancePanelLogic(USER_ID)
    return (
        <form onSubmit={handler.handleSubmit}>
            <output>{state.draftColor}</output>
            <button type="button" onClick={() => setter.setDraftColor('#ABCDEF')}>
                Draft
            </button>
            <button type="submit" disabled={!state.canSave}>
                Save
            </button>
        </form>
    )
}

async function renderProbe(): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <RouterContextProvider router={router}>
                    <QueryClientProvider client={queryClient!}>
                        <AccentContext.Provider value={ACCENT_CONTEXT}>
                            <AppearanceProbe />
                        </AccentContext.Provider>
                    </QueryClientProvider>
                </RouterContextProvider>,
            ),
        )
    })
    await act(async () => container.querySelector<HTMLButtonElement>('button')?.click())
    return container
}

async function submit(container: HTMLElement): Promise<void> {
    await act(async () => {
        container
            .querySelector('form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
}

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 1_500
    while (Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Wait for one real mutation to settle inside act.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
        if (condition()) return
    }
    expect(condition()).toBe(true)
}

function mutationStatus(): string | undefined {
    return queryClient?.getMutationCache().getAll()[0]?.state.status
}

beforeEach(() => {
    updateAccent.mockReset().mockResolvedValue(savedColor)
    invalidate.mockReset().mockResolvedValue(undefined)
    successToast.mockClear()
    errorToast.mockClear()
})

afterEach(async () => {
    await act(async () => activeRoot?.unmount())
    activeRoot = null
    queryClient?.clear()
    queryClient = null
    document.body.replaceChildren()
})

afterAll(async () => {
    invalidate.mockRestore()
    await GlobalRegistrator.unregister()
})

describe('personal appearance save feedback', () => {
    test('updates the normalized draft before the route refresh finishes', async () => {
        const { promise: refresh, resolve: finishRefresh } = Promise.withResolvers<void>()
        invalidate.mockReturnValue(refresh)
        const container = await renderProbe()
        await submit(container)
        await waitFor(() => invalidate.mock.calls.length === 1)
        const draftWhileRefreshing = container.querySelector('output')?.textContent
        const statusWhileRefreshing = mutationStatus()
        await act(async () => finishRefresh())
        await waitFor(() => mutationStatus() === 'success')

        expect(draftWhileRefreshing).toBe('#abcdef')
        expect(statusWhileRefreshing).toBe('pending')
        expect(successToast).toHaveBeenCalledTimes(1)
        expect(errorToast).not.toHaveBeenCalled()
        expect(updateAccent).toHaveBeenCalledWith({
            data: { expectedUserId: USER_ID, accentColor: '#ABCDEF' },
        })
    })

    test('reports a persisted color as saved when the route refresh rejects', async () => {
        invalidate.mockRejectedValue(new Error('Route refresh failed'))
        const container = await renderProbe()
        await submit(container)
        await waitFor(() => ['success', 'error'].includes(mutationStatus() ?? ''))

        expect(mutationStatus()).toBe('success')
        expect(container.querySelector('output')?.textContent).toBe('#abcdef')
        expect(successToast).toHaveBeenCalledTimes(1)
        expect(errorToast).not.toHaveBeenCalled()
    })

    test('still reports a failed server save without refreshing routes', async () => {
        updateAccent.mockRejectedValue(new Error('Save failed'))
        const container = await renderProbe()
        await submit(container)
        await waitFor(() => mutationStatus() === 'error')

        expect(container.querySelector('output')?.textContent).toBe('#ABCDEF')
        expect(errorToast).toHaveBeenCalledTimes(1)
        expect(successToast).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
    })

    test('does not show late save feedback after the account panel unmounts', async () => {
        const { promise: save, resolve: finishSave } =
            Promise.withResolvers<AccentColorUpdateResult>()
        updateAccent.mockReturnValue(save)
        const container = await renderProbe()
        await submit(container)
        await waitFor(() => updateAccent.mock.calls.length === 1)
        await act(async () => activeRoot?.unmount())
        activeRoot = null
        await act(async () => finishSave(savedColor))
        await waitFor(() => mutationStatus() === 'success')

        expect(invalidate).toHaveBeenCalledTimes(1)
        expect(successToast).not.toHaveBeenCalled()
        expect(errorToast).not.toHaveBeenCalled()
    })
})
