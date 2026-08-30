import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import type { LanguageUpdateResult as LanguageResult } from '../features/UserSettings/Types/language-server-result.types'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } =
    await import('@tanstack/react-router')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')
const { TooltipProvider } = await import('../shared/Tooltip')

const settingsRouter = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
})
const invalidate = spyOn(settingsRouter, 'invalidate').mockResolvedValue(undefined)

const settingsServer = await import('../features/UserSettings/server')
const updateLanguageHandler = spyOn(
    settingsServer,
    'updateCurrentUserLanguageHandler',
).mockResolvedValue({
    success: true,
    language: 'de',
    message: 'language.saved',
})

afterAll(() => {
    updateLanguageHandler.mockRestore()
    invalidate.mockRestore()
})

const { default: withTestLanguage } = await import('./Helpers/withTestLanguage')
const { default: LanguageSettingsPanel } =
    await import('../features/UserSettings/Components/LanguageSettingsPanel')
const { default: useTranslationStore } = await import('../language/useTranslationStore')

function LanguageProbe() {
    const { language, t } = useTranslationStore()
    return (
        <output data-language={language} data-testid="language-probe">
            {t('shell.account')}
        </output>
    )
}

let activeRoot: Root | null = null
let activeQueryClient: InstanceType<typeof QueryClient> | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)
    activeQueryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
        },
    })

    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider>
                        <RouterContextProvider router={settingsRouter}>
                            <QueryClientProvider client={activeQueryClient!}>
                                {element}
                            </QueryClientProvider>
                        </RouterContextProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
    })
    return container
}

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 1500
    while (!condition() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Poll one rendered state at a time inside act.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}

function getToastMessages(container: HTMLElement, tone?: string): Array<string> {
    const selector = tone ? '[data-toast-tone="' + tone + '"]' : '[data-toast-tone]'
    return [...container.querySelectorAll<HTMLElement>(selector)].map(
        (toast) => toast.textContent ?? '',
    )
}

async function chooseLanguage(container: HTMLElement, label: string): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')
    expect(trigger).not.toBeNull()

    await act(async () => {
        trigger?.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="listbox"]') !== null)

    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    expect(option).toBeDefined()
    await act(async () => {
        option?.dispatchEvent(
            new PointerEvent('pointerup', {
                bubbles: true,
                button: 0,
                cancelable: true,
                pointerType: 'mouse',
            }),
        )
        option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
    await waitFor(() => document.querySelector('[role="listbox"]') === null)
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    activeQueryClient?.clear()
    activeQueryClient = null
    updateLanguageHandler.mockReset()
    updateLanguageHandler.mockResolvedValue({
        success: true,
        language: 'de',
        message: 'language.saved',
    })
    invalidate.mockClear()
    document.body.replaceChildren()
    document.documentElement.lang = 'en'
})

describe('language settings panel', () => {
    test('keeps selection local until Save and prevents another selection while saving', async () => {
        let resolveSave!: (result: LanguageResult) => void
        updateLanguageHandler.mockReturnValue(
            new Promise<LanguageResult>((resolve) => {
                resolveSave = resolve
            }),
        )
        const container = await render(
            <>
                <LanguageSettingsPanel />
                <LanguageProbe />
            </>,
        )
        const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        expect(save.disabled).toBe(true)

        await chooseLanguage(container, 'German')
        expect(updateLanguageHandler).toHaveBeenCalledTimes(0)
        expect(
            container
                .querySelector('[data-testid="language-probe"]')
                ?.getAttribute('data-language'),
        ).toBe('en')
        expect(container.querySelector('[data-testid="language-probe"]')?.textContent).toBe(
            'Account',
        )
        expect(save.disabled).toBe(false)

        await click(save)
        await waitFor(() => updateLanguageHandler.mock.calls.length === 1 && save.disabled)
        expect(save.disabled).toBe(true)
        expect(container.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true)

        await act(async () => {
            container.querySelector<HTMLButtonElement>('[role="combobox"]')?.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    button: 0,
                    cancelable: true,
                    pointerType: 'mouse',
                }),
            )
            await Promise.resolve()
        })
        expect(document.querySelector('[role="listbox"]')).toBeNull()
        await act(async () => {
            container
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        })
        expect(updateLanguageHandler).toHaveBeenCalledTimes(1)
        expect(document.documentElement.lang).toBe('en')

        await act(async () => {
            resolveSave({ success: true, language: 'de', message: 'language.saved' })
        })
        await waitFor(() =>
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        )
        expect(container.querySelector('[data-testid="language-probe"]')?.textContent).toBe('Konto')
        expect(document.documentElement.lang).toBe('de')
    })

    test('keeps the saved toast while changing a new draft and disables Save when reverting it', async () => {
        updateLanguageHandler.mockResolvedValue({
            success: true,
            language: 'de',
            message: 'language.saved',
        })
        const container = await render(
            <>
                <LanguageSettingsPanel />
                <LanguageProbe />
            </>,
        )

        await chooseLanguage(container, 'German')
        await click(container.querySelector<HTMLButtonElement>('button[type="submit"]')!)
        await waitFor(() =>
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        )

        expect(updateLanguageHandler).toHaveBeenCalledWith({ data: { language: 'de' } })
        expect(
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        ).toBeTrue()
        expect(invalidate).toHaveBeenCalledTimes(1)

        await chooseLanguage(container, 'Spanisch')
        expect(
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        ).toBeTrue()
        expect(document.documentElement.lang).toBe('de')
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            false,
        )
        expect(updateLanguageHandler).toHaveBeenCalledTimes(1)

        await chooseLanguage(container, 'Deutsch')
        expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(
            true,
        )
        expect(updateLanguageHandler).toHaveBeenCalledTimes(1)
    })

    test('keeps a failed draft and retries the same value after a domain failure', async () => {
        updateLanguageHandler
            .mockResolvedValueOnce({ success: false, message: 'language.saveFailed' })
            .mockResolvedValueOnce({ success: true, language: 'de', message: 'language.saved' })
        const container = await render(
            <>
                <LanguageSettingsPanel />
                <LanguageProbe />
            </>,
        )

        await chooseLanguage(container, 'German')
        const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        await click(save)
        await waitFor(() =>
            getToastMessages(container, 'error').some((text) =>
                text.includes('Your language could not be saved.'),
            ),
        )
        expect(
            container
                .querySelector('[data-testid="language-probe"]')
                ?.getAttribute('data-language'),
        ).toBe('en')
        expect(save.disabled).toBe(false)

        await click(save)
        await waitFor(() =>
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        )
        expect(updateLanguageHandler).toHaveBeenCalledTimes(2)
        expect(
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        ).toBeTrue()
    })

    test('keeps the active catalog and draft retryable when loading the selected catalog fails', async () => {
        const { LANGUAGE_RESOURCE_LOADERS } = await import('../config/language.config')
        const loader = spyOn(LANGUAGE_RESOURCE_LOADERS, 'de').mockRejectedValue(
            new Error('Synthetic resource failure'),
        )
        try {
            const container = await render(
                <>
                    <LanguageSettingsPanel />
                    <LanguageProbe />
                </>,
            )
            await chooseLanguage(container, 'German')
            const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
            await click(save)
            await waitFor(() =>
                getToastMessages(container, 'error').some((text) =>
                    text.includes('This language could not be loaded.'),
                ),
            )
            expect(updateLanguageHandler).toHaveBeenCalledTimes(0)
            expect(
                container
                    .querySelector('[data-testid="language-probe"]')
                    ?.getAttribute('data-language'),
            ).toBe('en')
            expect(save.disabled).toBe(false)
        } finally {
            loader.mockRestore()
        }
    })

    test('keeps the draft retryable after a rejected save request', async () => {
        updateLanguageHandler
            .mockRejectedValueOnce(new Error('Synthetic network failure'))
            .mockResolvedValueOnce({ success: true, language: 'de', message: 'language.saved' })
        const container = await render(
            <>
                <LanguageSettingsPanel />
                <LanguageProbe />
            </>,
        )

        await chooseLanguage(container, 'German')
        const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
        await click(save)
        await waitFor(() =>
            getToastMessages(container, 'error').some((text) =>
                text.includes('Your language could not be saved.'),
            ),
        )
        expect(container.querySelector('[role="combobox"]')?.textContent).toContain('German')
        expect(document.documentElement.lang).toBe('en')
        expect(save.disabled).toBe(false)

        await click(save)
        await waitFor(() =>
            getToastMessages(container, 'success').some((text) =>
                text.includes('Deine Sprache wurde gespeichert.'),
            ),
        )
        expect(document.documentElement.lang).toBe('de')
        expect(updateLanguageHandler).toHaveBeenCalledTimes(2)
    })
})
