import { afterEach, beforeEach, expect, jest, spyOn, test } from 'bun:test'
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
import { LIVE_SCROLL_RESTORE_TIMEOUT_MS } from '@/config/realtime.config.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root
let container: HTMLDivElement
let router: ReturnType<typeof makeRouter>
let top: number
let scroll: ReturnType<typeof spyOn<typeof window, 'scrollTo'>>
let originalScrollY: PropertyDescriptor | undefined
let originalState: PropertyDescriptor | undefined
let height: number
const originalHeight = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight')
const originalViewport = Object.getOwnPropertyDescriptor(window, 'innerHeight')
const originalObserver = globalThis.ResizeObserver

class LayoutObserver {
    static instances: LayoutObserver[] = []
    disconnected = false
    constructor(readonly callback: () => void) {
        LayoutObserver.instances.push(this)
    }
    observe() {}
    disconnect() {
        this.disconnected = true
    }
}

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
    suspended,
}: {
    pending: boolean
    generation: number
    verification: number
    suspended: boolean
}) {
    const capture = useLiveScrollRestoration(pending, generation, verification, suspended)
    return <button onClick={capture}>Pause protected page</button>
}

async function render(pending: boolean, generation = 1, verification = 1, suspended = false) {
    await act(async () =>
        root.render(
            <RouterContextProvider router={router}>
                <Probe
                    pending={pending}
                    generation={generation}
                    verification={verification}
                    suspended={suspended}
                />
            </RouterContextProvider>,
        ),
    )
}

beforeEach(() => {
    router = makeRouter()
    originalState = Object.getOwnPropertyDescriptor(router, 'state')
    originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
    top = 1500
    height = 4000
    Object.defineProperty(document.documentElement, 'scrollHeight', {
        configurable: true,
        get: () => height,
    })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
    globalThis.ResizeObserver = LayoutObserver as unknown as typeof ResizeObserver
    LayoutObserver.instances = []
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => top })
    scroll = spyOn(window, 'scrollTo').mockImplementation((options) => {
        if (typeof options === 'object')
            top = Math.min(options.top ?? top, Math.max(0, height - window.innerHeight))
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    scroll.mockRestore()
    globalThis.ResizeObserver = originalObserver
    if (originalHeight)
        Object.defineProperty(document.documentElement, 'scrollHeight', originalHeight)
    else Reflect.deleteProperty(document.documentElement, 'scrollHeight')
    if (originalViewport) Object.defineProperty(window, 'innerHeight', originalViewport)
    else Reflect.deleteProperty(window, 'innerHeight')
    jest.useRealTimers()
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
    top = 720
    await act(async () => container.querySelector('button')!.click())
    await render(false, 1, 3)
    expect(scroll).toHaveBeenLastCalledWith({ left: 0, top: 720, behavior: 'instant' })
})

test('waits for a short loading page to grow before restoring the saved offset', async () => {
    await pause()
    height = 1100
    await render(false)
    const observer = LayoutObserver.instances.at(-1)!
    expect(scroll).not.toHaveBeenCalled()
    height = 1800
    await act(async () => observer.callback())
    expect(scroll).not.toHaveBeenCalled()
    height = 4000
    await act(async () => observer.callback())
    expect(top).toBe(1500)
    expect(observer.disconnected).toBe(true)
    await act(async () => observer.callback())
    expect(scroll).toHaveBeenCalledTimes(1)
})

test('releases the offset at the bounded deadline when content remains shorter', async () => {
    jest.useFakeTimers()
    await pause()
    height = 1100
    await render(false)
    const observer = LayoutObserver.instances.at(-1)!
    await act(async () => jest.advanceTimersByTime(LIVE_SCROLL_RESTORE_TIMEOUT_MS - 1))
    expect(scroll).not.toHaveBeenCalled()
    await act(async () => jest.advanceTimersByTime(1))
    expect(top).toBe(100)
    expect(observer.disconnected).toBe(true)
    height = 4000
    await act(async () => observer.callback())
    expect(scroll).toHaveBeenCalledTimes(1)
})

test('same-entry identity invalidation keeps waiting for the original content geometry', async () => {
    await pause()
    height = 1100
    await render(false)
    const observer = LayoutObserver.instances.at(-1)!
    router.emit({
        type: 'onBeforeNavigate',
        fromLocation: router.state.location,
        toLocation: router.state.location,
        pathChanged: false,
        hrefChanged: false,
        hashChanged: false,
    })
    height = 4000
    await act(async () => observer.callback())
    expect(top).toBe(1500)
})

test.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])(
    'abandons delayed restoration after %s user intent',
    async (intent) => {
        jest.useFakeTimers()
        await pause()
        height = 1100
        await render(false)
        const observer = LayoutObserver.instances.at(-1)!
        window.dispatchEvent(new Event(intent, { bubbles: true }))
        height = 4000
        await act(async () => {
            observer.callback()
            jest.advanceTimersByTime(LIVE_SCROLL_RESTORE_TIMEOUT_MS)
        })
        expect(scroll).not.toHaveBeenCalled()
        expect(observer.disconnected).toBe(true)
    },
)

test.each([
    'principal',
    'url',
    'history-entry',
    'navigation',
    'suspension',
    'pending',
    'unmount',
] as const)('fences delayed restoration on %s and disconnects its observer', async (change) => {
    jest.useFakeTimers()
    await pause()
    height = 1100
    await render(false)
    const observer = LayoutObserver.instances.at(-1)!
    if (change === 'unmount') await act(async () => root.unmount())
    else if (change === 'navigation')
        router.emit({
            type: 'onBeforeNavigate',
            fromLocation: router.state.location,
            toLocation: { ...router.state.location, href: '/users' },
            pathChanged: true,
            hrefChanged: true,
            hashChanged: false,
        })
    else if (change === 'url' || change === 'history-entry') {
        const state = router.state
        Object.defineProperty(router, 'state', {
            configurable: true,
            get: () => ({
                ...state,
                location: {
                    ...state.location,
                    href: change === 'url' ? '/users' : state.location.href,
                    state: {
                        ...state.location.state,
                        __TSR_key:
                            change === 'history-entry'
                                ? 'other'
                                : state.location.state['__TSR_key'],
                    },
                },
            }),
        })
    } else
        await render(
            change === 'pending',
            change === 'principal' ? 2 : 1,
            1,
            change === 'suspension',
        )
    height = 4000
    await act(async () => {
        observer.callback()
        jest.advanceTimersByTime(LIVE_SCROLL_RESTORE_TIMEOUT_MS)
    })
    expect(scroll).not.toHaveBeenCalled()
    expect(observer.disconnected).toBe(true)
})
