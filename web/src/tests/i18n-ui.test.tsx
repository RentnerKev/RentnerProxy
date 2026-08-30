import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import {
    AVAILABLE_LANGUAGES,
    FLAG_IMAGES,
    isAppLanguage,
    LANGUAGE_RESOURCE_LOADERS,
} from '../config/language.config'
import { emailSchema } from '../features/Auth/Shared/validation'
import useTranslationStore, {
    AuthenticatedLanguageProvider,
    TranslationContext,
    type TranslationStore,
} from '../language/useTranslationStore'
import { getValidationIssue } from '../shared/Forms/Helpers/getFieldErrorMessage'
import FieldError from '../shared/Forms/FieldError'
import FormMessage from '../shared/Forms/FormMessage'
import withTestLanguage, { bootstraps } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, StrictMode, useContext, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { renderToString } = await import('react-dom/server')
const { default: PasswordInput } = await import('../shared/Forms/PasswordInput')
const { default: SelectControl } = await import('../shared/Select')
const { TooltipProvider } = await import('../shared/Tooltip')
let activeRoot: Root | null = null
let currentStore: TranslationStore | null = null

function LanguageProbe() {
    const store = useContext(TranslationContext)
    useEffect(() => {
        currentStore = store
    }, [store])
    const { language, t } = useTranslationStore()
    return <output data-language={language}>{t('shell.account')}</output>
}

function PickerProbe() {
    const { language, setLanguage, t } = useTranslationStore()
    return (
        <SelectControl
            ariaLabel={t('language.label')}
            value={language}
            options={AVAILABLE_LANGUAGES.map((value) => ({
                value,
                label: t(`language.names.${value}`),
                imageSrc: FLAG_IMAGES[value],
            }))}
            onValueChange={(value) => {
                if (isAppLanguage(value)) void setLanguage?.(value)
            }}
        />
    )
}

async function render(element: ReactElement) {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)
    await act(async () => {
        activeRoot?.render(element)
    })
    return container
}

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 1500
    while (!condition() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Poll one rendered state at a time inside act.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    currentStore = null
    document.body.replaceChildren()
    document.documentElement.lang = 'en'
})

describe('authenticated language UI', () => {
    test('renders the selected language on the server without cross-request language state', () => {
        const german = renderToString(withTestLanguage(<LanguageProbe />, 'de'))
        const french = renderToString(withTestLanguage(<LanguageProbe />, 'fr'))
        const english = renderToString(withTestLanguage(<LanguageProbe />, 'en'))
        expect(german).toContain('Konto')
        expect(french).toContain('Compte')
        expect(english).toContain('Account')
        expect(renderToString(withTestLanguage(<LanguageProbe />, 'de'))).toBe(german)
        const dropdown = renderToString(withTestLanguage(<PickerProbe />, 'de'))
        expect(dropdown).toContain('Deutsch')
        expect(dropdown).toContain(FLAG_IMAGES.de)
    })

    test('preserves the selected language through StrictMode effect replay', async () => {
        const container = await render(
            <StrictMode>{withTestLanguage(<LanguageProbe />, 'de')}</StrictMode>,
        )
        expect(container.textContent).toBe('Konto')
        expect(document.documentElement.lang).toBe('de')
        await act(async () => {
            await currentStore?.setLanguage('es')
        })
        expect(container.textContent).toBe('Cuenta')
        expect(document.documentElement.lang).toBe('es')
    })

    test('keeps a user store on route refresh and adopts a changed persisted preference', async () => {
        const container = await render(withTestLanguage(<LanguageProbe />, 'de'))
        const originalStore = currentStore
        await act(async () => {
            activeRoot?.render(
                <AuthenticatedLanguageProvider bootstrap={structuredClone(bootstraps.de)}>
                    <LanguageProbe />
                </AuthenticatedLanguageProvider>,
            )
        })
        expect(currentStore).toBe(originalStore)
        await act(async () => {
            activeRoot?.render(
                <AuthenticatedLanguageProvider bootstrap={structuredClone(bootstraps.fr)}>
                    <LanguageProbe />
                </AuthenticatedLanguageProvider>,
            )
        })
        expect(currentStore).toBe(originalStore)
        expect(container.textContent).toBe('Compte')
        expect(document.documentElement.lang).toBe('fr')
    })

    test('updates already-visible validation and server feedback after a language change', async () => {
        const error = getValidationIssue(emailSchema, '')
        const container = await render(
            withTestLanguage(
                <>
                    <LanguageProbe />
                    <FieldError id="email-error" errors={[error]} />
                    <FieldError
                        id="confirmation-error"
                        errors={['account.validation.passwordsDoNotMatch']}
                    />
                    <FormMessage tone="error">errors.permission_denied</FormMessage>
                </>,
            ),
        )
        expect(container.textContent).toContain('This field is required.')
        await act(async () => {
            await currentStore?.setLanguage('de')
        })
        expect(container.querySelector('#email-error')?.textContent).toBe(
            'Dieses Feld ist erforderlich.',
        )
        expect(container.querySelector('#confirmation-error')?.textContent).toContain('Passwörter')
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
            'Du hast keine Berechtigung für diese Änderung.',
        )
        expect(container.textContent).not.toContain('This field is required.')
    })

    test('shows all four flags in the dropdown and keeps the selected flag after switching', async () => {
        const container = await render(withTestLanguage(<PickerProbe />))
        const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
        expect(trigger.querySelector('img')?.getAttribute('src')).toBe(FLAG_IMAGES.en)
        await act(async () => {
            trigger.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    button: 0,
                    cancelable: true,
                    pointerType: 'mouse',
                }),
            )
        })
        await waitFor(() => document.querySelector('[role="listbox"]') !== null)
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        expect(options.length).toBe(4)
        expect(options.map((option) => option.querySelector('img')?.getAttribute('src'))).toEqual(
            AVAILABLE_LANGUAGES.map((language) => FLAG_IMAGES[language]),
        )
        const german = options.find((option) => option.textContent?.trim() === 'German')!
        await act(async () => {
            german.dispatchEvent(
                new PointerEvent('pointerup', {
                    bubbles: true,
                    button: 0,
                    cancelable: true,
                    pointerType: 'mouse',
                }),
            )
            german.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        })
        await waitFor(() => trigger.textContent?.trim() === 'Deutsch')
        expect(trigger.querySelector('img')?.getAttribute('src')).toBe(FLAG_IMAGES.de)
        expect(trigger.getAttribute('aria-label')).toBe('Anzeigesprache')
    })

    test('unmounting authenticated UI restores English and public controls load no catalog', async () => {
        await render(withTestLanguage(<LanguageProbe />, 'fr'))
        expect(document.documentElement.lang).toBe('fr')
        await act(async () => {
            activeRoot?.unmount()
        })
        activeRoot = null
        expect(document.documentElement.lang).toBe('en')
        const loaders = AVAILABLE_LANGUAGES.map((language) =>
            spyOn(LANGUAGE_RESOURCE_LOADERS, language),
        )
        try {
            const container = await render(
                <TooltipProvider>
                    <>
                        <PasswordInput id="public-password" aria-label="Password" />
                        <FormMessage tone="info">Public English response</FormMessage>
                    </>
                </TooltipProvider>,
            )
            expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
                'Show password',
            )
            expect(container.textContent).toContain('Public English response')
            expect(document.documentElement.lang).toBe('en')
            for (const loader of loaders) expect(loader).not.toHaveBeenCalled()
        } finally {
            loaders.forEach((loader) => loader.mockRestore())
        }
    })
})
