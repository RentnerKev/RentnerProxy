import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { AnyRouter, RouteComponent } from '@tanstack/react-router'
import type { Root } from 'react-dom/client'

import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
import { LANGUAGE_RESOURCE_LOADERS } from '@/lib/Language/resources.ts'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'
import { createPageError, getPageErrorDetails } from '@/lib/Errors/pageError.ts'
import withTestLanguage, { catalogs } from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, lazy } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createRootRoute, createRoute, createRouter, createMemoryHistory, Outlet, RouterProvider } =
    await import('@tanstack/react-router')
const { default: GlobalErrorPage } = await import('@/shared/SystemStatePage/GlobalErrorPage.tsx')
const { default: DelayedLoadingPage } =
    await import('@/shared/SystemStatePage/DelayedLoadingPage.tsx')
let activeRoot: Root | null = null

function errorRouter(
    loader: () => void | Promise<void>,
    language?: AppLanguage,
    component: RouteComponent = () => <p data-testid="recovered">Recovered test page</p>,
) {
    const root = createRootRoute({
        component: language ? () => withTestLanguage(<Outlet />, language) : Outlet,
    })
    const page = createRoute({
        getParentRoute: () => root,
        path: '/',
        loader,
        component,
        errorComponent: GlobalErrorPage,
    })
    return createRouter({
        routeTree: root.addChildren([page]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
        defaultPendingMinMs: 0,
        defaultPendingMs: 1,
        defaultPendingComponent: DelayedLoadingPage,
    })
}

async function render(router: AnyRouter) {
    const container = document.createElement('div')
    document.body.append(container)

    activeRoot = createRoot(container, { onCaughtError: () => {} })
    await act(async () => {
        await router.load()
        activeRoot?.render(<RouterProvider router={router} />)
    })
    return container
}

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 1500
    while (!condition() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Wait for the next router render inside act.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}

afterEach(async () => {
    await act(async () => activeRoot?.unmount())
    activeRoot = null
    document.body.replaceChildren()
    document.documentElement.lang = 'en'
    sessionStorage.clear()
})

describe('global error page', () => {
    test.each(['loader', 'component'] as const)(
        'does not flash the loading screen while a %s is briefly pending',
        async (kind) => {
            const pending = Promise.withResolvers<void>()
            const component = lazy(async () => {
                await pending.promise
                return { default: () => <p data-testid="recovered">Recovered test page</p> }
            })
            const router =
                kind === 'loader'
                    ? errorRouter(() => pending.promise)
                    : errorRouter(() => {}, undefined, component)
            const container = document.createElement('div')
            document.body.append(container)
            activeRoot = createRoot(container)
            let navigation: Promise<void> | undefined
            jest.useFakeTimers()
            try {
                await act(async () => {
                    navigation = router.load()
                    activeRoot?.render(<RouterProvider router={router} />)
                })
                await act(async () => jest.advanceTimersByTime(250))
                expect(container.querySelector('output')).toBeNull()
                await act(async () => {
                    pending.resolve()
                    await navigation
                })
                await act(async () => jest.advanceTimersByTime(2_000))
                expect(container.querySelector('[data-testid="recovered"]')).not.toBeNull()
                expect(container.querySelector('output')).toBeNull()
            } finally {
                pending.resolve()
                await navigation
                jest.useRealTimers()
            }
        },
    )

    test('shows a public loading screen without fetching catalogs, then reveals the ready route', async () => {
        const pending = Promise.withResolvers<void>()
        const router = errorRouter(() => pending.promise)
        const container = document.createElement('div')
        document.body.append(container)
        activeRoot = createRoot(container)
        const loaders = AVAILABLE_LANGUAGES.map((language) =>
            spyOn(LANGUAGE_RESOURCE_LOADERS, language),
        )
        let navigation: Promise<void> | undefined
        try {
            await act(async () => {
                navigation = router.load()
                activeRoot?.render(<RouterProvider router={router} />)
            })
            await waitFor(() => container.querySelector('output') !== null)
            expect(container.querySelector('output')?.textContent).toBe(
                catalogs.en.system.loading.description,
            )
            expect(container.querySelector('h1')?.textContent).toBe(
                catalogs.en.system.loading.title,
            )
            expect(container.querySelector('[data-testid="recovered"]')).toBeNull()
            for (const loader of loaders) expect(loader).not.toHaveBeenCalled()

            await act(async () => {
                pending.resolve()
                await navigation
            })
            await waitFor(() => container.querySelector('[data-testid="recovered"]') !== null)
            expect(container.querySelector('output')).toBeNull()
        } finally {
            pending.resolve()
            await navigation
            loaders.forEach((loader) => loader.mockRestore())
        }
    })

    test('explains a schema failure publicly in English without loading language catalogs', async () => {
        const error = createPageError(Object.assign(new Error('synthetic SQL'), { errno: '42703' }))
        const loaders = AVAILABLE_LANGUAGES.map((language) =>
            spyOn(LANGUAGE_RESOURCE_LOADERS, language),
        )
        try {
            const container = await render(
                errorRouter(() => {
                    throw error
                }),
            )
            expect(container.querySelector('h1')?.textContent).toBe('Database update required')
            const alert = container.querySelector('[role="alert"]')!
            expect(alert.textContent).toContain('503')
            expect(alert.textContent).toContain('A required table or field is missing.')
            expect(alert.textContent).toContain('pending database migrations')
            expect(alert.textContent).toContain('RP_DATABASE_SCHEMA')
            expect(alert.textContent).toContain(getPageErrorDetails(error).reference!)
            expect(container.querySelector('pre code')?.textContent).toBe('bun run db:migrate')
            expect(container.querySelector('button')).toBeNull()
            expect(container.textContent).not.toContain('synthetic SQL')
            expect(container.textContent).not.toContain('system.error.')
            for (const loader of loaders) expect(loader).not.toHaveBeenCalled()
        } finally {
            loaders.forEach((loader) => loader.mockRestore())
        }
    })

    test.each([...AVAILABLE_LANGUAGES])(
        'uses %s for an authenticated error page',
        async (language) => {
            const error = createPageError({ code: '53300' })
            const container = await render(
                errorRouter(() => {
                    throw error
                }, language),
            )
            const copy = catalogs[language].system.error
            expect(container.querySelector('h1')?.textContent).toBe(copy.causes.databaseBusy.title)
            expect(container.textContent).toContain(copy.causes.databaseBusy.description)
            expect(container.textContent).toContain(copy.causes.databaseBusy.nextStep)
            expect(container.textContent).toContain(copy.code)
            expect(container.textContent).toContain(copy.reference)
            expect(container.textContent).toContain('RP_DATABASE_BUSY')
            expect(container.querySelector('pre')).toBeNull()
            expect(container.textContent).not.toContain('system.error.')
        },
    )

    test('does not expose raw messages, tokens, SQL, or stack traces for an unknown error', async () => {
        const error = new Error(
            'SELECT fixture-password FROM fixture; <script>fixture-token</script>',
        )
        const container = await render(
            errorRouter(() => {
                throw error
            }),
        )
        expect(container.querySelector('h1')?.textContent).toBe('The page could not be loaded')
        expect(container.textContent).toContain('could not determine a more specific cause')
        expect(container.textContent).toContain('RP_UNEXPECTED')
        expect(container.textContent).not.toContain('fixture-password')
        expect(container.textContent).not.toContain('fixture-token')
        expect(container.textContent).not.toContain('system-state-ui.test')
        expect(container.querySelector('pre')).toBeNull()
        expect(container.querySelector('script')).toBeNull()
    })

    test('automatically reloads broken application files with a durable cooldown', async () => {
        sessionStorage.clear()
        jest.useFakeTimers()
        const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
        try {
            const router = errorRouter(() => {
                throw new Error('language.loadFailed')
            })
            const invalidate = spyOn(router, 'invalidate')
            const container = await render(router)
            expect(container.querySelector('h1')?.textContent).toBe(
                'Application files could not be loaded',
            )
            await act(async () => jest.advanceTimersByTime(1_000))
            expect(reload).toHaveBeenCalledTimes(1)
            expect(invalidate).not.toHaveBeenCalled()
            await act(async () => activeRoot?.unmount())
            activeRoot = null
            await render(
                errorRouter(() => {
                    throw new Error('language.loadFailed')
                }),
            )
            await act(async () => jest.advanceTimersByTime(30_000))
            expect(reload).toHaveBeenCalledTimes(1)
            invalidate.mockRestore()
        } finally {
            reload.mockRestore()
            jest.useRealTimers()
            sessionStorage.clear()
        }
    })

    test('automatically retries the failed loader and recovers after the underlying error is resolved', async () => {
        let unavailable = true
        let attempts = 0
        const container = await render(
            errorRouter(() => {
                attempts += 1
                if (unavailable) throw createPageError({ code: '53300' })
            }),
        )
        expect(container.querySelector('h1')?.textContent).toBe('Database connection limit reached')
        const previousAttempts = attempts
        unavailable = false
        await waitFor(() => container.querySelector('[data-testid="recovered"]') !== null)
        expect(attempts).toBeGreaterThan(previousAttempts)
        expect(container.querySelector('[role="alert"]')).toBeNull()
    })

    test.each([401, 403, 404])(
        'keeps permanent %s errors visible without automatic retries',
        async (status) => {
            jest.useFakeTimers()
            let attempts = 0
            try {
                const container = await render(
                    errorRouter(() => {
                        attempts += 1
                        throw Object.assign(new Error('permanent'), { status })
                    }),
                )
                const original = attempts
                await act(async () => {
                    window.dispatchEvent(new Event('online'))
                    window.dispatchEvent(new Event('focus'))
                    jest.advanceTimersByTime(60_000)
                })
                expect(attempts).toBe(original)
                expect(container.querySelector('button')).toBeNull()
                expect(container.querySelector('a')?.getAttribute('href')).toBe('/')
                expect(container.querySelector('[role="alert"]')).not.toBeNull()
            } finally {
                jest.useRealTimers()
            }
        },
    )

    test('pauses recovery offline and cancels queued recovery on unmount', async () => {
        jest.useFakeTimers()
        const originalOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine')
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
        let attempts = 0
        try {
            await render(
                errorRouter(() => {
                    attempts += 1
                    throw new Error('Failed to fetch')
                }),
            )
            const original = attempts
            await act(async () => jest.advanceTimersByTime(30_000))
            expect(attempts).toBe(original)
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
            await act(async () => {
                window.dispatchEvent(new Event('online'))
                jest.advanceTimersByTime(1)
            })
            expect(attempts).toBeGreaterThan(original)
            const retried = attempts
            await act(async () => activeRoot?.unmount())
            activeRoot = null
            await act(async () => jest.advanceTimersByTime(60_000))
            expect(attempts).toBe(retried)
        } finally {
            if (originalOnline) Object.defineProperty(navigator, 'onLine', originalOnline)
            else Reflect.deleteProperty(navigator, 'onLine')
            jest.useRealTimers()
        }
    })

    test('keeps backoff across repeated boundary failures and pauses hidden asset recovery', async () => {
        jest.useFakeTimers()
        let attempts = 0
        try {
            await render(
                errorRouter(() => {
                    attempts += 1
                    throw new Error('Failed to fetch')
                }),
            )
            const original = attempts
            await act(async () => jest.advanceTimersByTime(1_000))
            expect(attempts).toBe(original + 1)
            await act(async () => {
                window.dispatchEvent(new Event('focus'))
                jest.advanceTimersByTime(1_000)
            })
            expect(attempts).toBe(original + 1)
            await act(async () => jest.advanceTimersByTime(1_000))
            expect(attempts).toBe(original + 2)
            await act(async () => activeRoot?.unmount())
            activeRoot = null
            const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
            Object.defineProperty(document, 'visibilityState', {
                configurable: true,
                value: 'hidden',
            })
            const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
            try {
                await render(
                    errorRouter(() => {
                        throw new Error('language.loadFailed')
                    }),
                )
                await act(async () => jest.advanceTimersByTime(30_000))
                expect(reload).not.toHaveBeenCalled()
                Object.defineProperty(document, 'visibilityState', {
                    configurable: true,
                    value: 'visible',
                })
                await act(async () => {
                    document.dispatchEvent(new Event('visibilitychange'))
                    jest.advanceTimersByTime(1)
                })
                expect(reload).toHaveBeenCalledTimes(1)
            } finally {
                reload.mockRestore()
                if (visibility) Object.defineProperty(document, 'visibilityState', visibility)
                else Reflect.deleteProperty(document, 'visibilityState')
            }
        } finally {
            jest.useRealTimers()
        }
    })
})
