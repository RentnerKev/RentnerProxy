import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { AnyRouter } from '@tanstack/react-router'
import type { Root } from 'react-dom/client'

import { AVAILABLE_LANGUAGES, LANGUAGE_RESOURCE_LOADERS } from '../config/language.config'
import type { AppLanguage } from '../language/useTranslationStore'
import { createPageError, getPageErrorDetails } from '../shared/Helpers/pageError'
import withTestLanguage, { catalogs } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createRootRoute, createRoute, createRouter, createMemoryHistory, Outlet, RouterProvider } =
    await import('@tanstack/react-router')
const { default: GlobalErrorPage } =
    await import('../layout/Components/SystemStatePage/GlobalErrorPage')
let activeRoot: Root | null = null

function errorRouter(loader: () => void, language?: AppLanguage) {
    const root = createRootRoute({
        component: language ? () => withTestLanguage(<Outlet />, language) : Outlet,
    })
    const page = createRoute({
        getParentRoute: () => root,
        path: '/',
        loader,
        component: () => <p data-testid="recovered">Recovered test page</p>,
        errorComponent: GlobalErrorPage,
    })
    return createRouter({
        routeTree: root.addChildren([page]),
        history: createMemoryHistory({ initialEntries: ['/'] }),
        defaultPendingMinMs: 0,
    })
}

async function render(router: AnyRouter) {
    const container = document.createElement('div')
    document.body.append(container)
    // The router intentionally catches these fixture errors; do not print React's error stacks.
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
})

describe('global error page', () => {
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
            expect(container.querySelector('button')?.textContent).toBe('Try again')
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

    test('reloads the document when an application or language file could not be loaded', async () => {
        const router = errorRouter(() => {
            throw new Error('language.loadFailed')
        })
        const container = await render(router)
        const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
        const invalidate = spyOn(router, 'invalidate')
        try {
            expect(container.querySelector('h1')?.textContent).toBe(
                'Application files could not be loaded',
            )
            await act(async () => {
                container.querySelector<HTMLButtonElement>('button')!.click()
            })
            expect(reload).toHaveBeenCalledTimes(1)
            expect(invalidate).not.toHaveBeenCalled()
        } finally {
            reload.mockRestore()
            invalidate.mockRestore()
        }
    })

    test('retries the failed loader and recovers after the underlying error is resolved', async () => {
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
        await act(async () => {
            container.querySelector<HTMLButtonElement>('button')!.click()
        })
        await waitFor(() => container.querySelector('[data-testid="recovered"]') !== null)
        expect(attempts).toBeGreaterThan(previousAttempts)
        expect(container.querySelector('[role="alert"]')).toBeNull()
    })
})
