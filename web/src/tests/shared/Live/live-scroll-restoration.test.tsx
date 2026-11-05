import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterContextProvider,
} from '@tanstack/react-router'
import useLiveScrollRestoration from '@/shared/Live/Hooks/useLiveScrollRestoration.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLDivElement
let router: ReturnType<typeof makeRouter>
let top: number
let scroll: ReturnType<typeof spyOn<typeof window, 'scrollTo'>>
let originalScrollY: PropertyDescriptor | undefined
let originalState: PropertyDescriptor | undefined

function makeRouter() {
    return createRouter({
        routeTree: createRootRoute(),
        history: createMemoryHistory({ initialEntries: ['/backups'] }),
    })
}

function Probe({
    pending,
    generation,
    verification,
}: {
    pending: boolean
    generation: number
    verification: number
}) {
    const capture = useLiveScrollRestoration(pending, generation, verification)
    return <button onClick={capture}>Pause protected page</button>
}

async function render(pending: boolean, generation = 1, verification = 1) {
    await act(async () =>
        root.render(
            <RouterContextProvider router={router}>
                <Probe pending={pending} generation={generation} verification={verification} />
            </RouterContextProvider>,
        ),
    )
}

beforeEach(() => {
    router = makeRouter()
    originalState = Object.getOwnPropertyDescriptor(router, 'state')
    originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    top = 1500
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => top })
    scroll = spyOn(window, 'scrollTo').mockImplementation(() => {})
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    scroll.mockRestore()
    if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY)
    else Reflect.deleteProperty(window, 'scrollY')
    if (originalState) Object.defineProperty(router, 'state', originalState)
    else Reflect.deleteProperty(router, 'state')
})

async function pause() {
    await render(false)
    await act(async () => container.querySelector('button')!.click())
    await render(true)
    // Hiding the long protected page clamps the browser's document scroll to zero.
    top = 0
    expect(scroll).not.toHaveBeenCalled()
}

test('restores scroll after transient identity verification reveals the same page', async () => {
    await pause()
    await render(false)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ left: 0, top: 1500, behavior: 'instant' })
    await render(false)
    expect(scroll).toHaveBeenCalledTimes(1)
})

test('repeated pending checks retain the original position instead of the collapsed page', async () => {
    await pause()
    await act(async () => container.querySelector('button')!.click())
    await render(true)
    await render(false)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ left: 0, top: 1500, behavior: 'instant' })
})

test.each(['principal', 'url', 'history-entry'] as const)(
    'does not restore a position after the %s changes',
    async (change) => {
        await pause()
        const state = router.state
        const historyKey = '__TSR_key'
        Object.defineProperty(router, 'state', {
            configurable: true,
            get: () => ({
                ...state,
                location: {
                    ...state.location,
                    href: change === 'url' ? '/users' : state.location.href,
                    state: {
                        ...state.location.state,
                        [historyKey]:
                            change === 'history-entry'
                                ? 'new-entry'
                                : state.location.state[historyKey],
                    },
                },
            }),
        })
        await render(false, change === 'principal' ? 2 : 1)
        expect(scroll).not.toHaveBeenCalled()
    },
)

test('initial identity verification leaves the router-owned initial scroll untouched', async () => {
    await render(true)
    await render(false)
    expect(scroll).not.toHaveBeenCalled()
})

test('a batched verification restores the page after maintenance without a pending render', async () => {
    await render(false)
    await act(async () => container.querySelector('button')!.click())
    top = 0
    await render(false, 1, 2)
    expect(scroll).toHaveBeenCalledWith({ left: 0, top: 1500, behavior: 'instant' })
})
