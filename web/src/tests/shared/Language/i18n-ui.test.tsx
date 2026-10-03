import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { AVAILABLE_LANGUAGES, LANGUAGE_COUNTRY_CODES } from '@/config/language.config.ts'
import { isAppLanguage } from '@/lib/Language/language.ts'
import { LANGUAGE_RESOURCE_LOADERS } from '@/lib/Language/resources.ts'
import { emailSchema } from '@/lib/Auth/validation.ts'
import {
    AuthenticatedLanguageProvider,
    TranslationContext,
} from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { TranslationStore } from '@/shared/Language/Types/language.types.ts'
import getFieldErrorMessage, { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import FormMessage from '@/shared/Forms/FormMessage.tsx'
import withTestLanguage, { bootstraps, catalogs } from '@/tests/Helpers/withTestLanguage.tsx'
import useControlLocalization from '@/layouts/RootLayout/Hooks/useControlLocalization.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, StrictMode, useContext, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { renderToString } = await import('react-dom/server')
const { PasswordInput, InputProvider } = await import('@rentnerkev/inputs')
const { SelectProvider } = await import('@rentnerkev/select')
const { CustomSelect } = await import('@rentnerkev/select/select')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
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

function renderLanguage(value: keyof typeof LANGUAGE_COUNTRY_CODES, label: string) {
    return (
        <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`flag:${LANGUAGE_COUNTRY_CODES[value]} h-4 w-6`} />
            <span>{label}</span>
        </span>
    )
}

function PickerProbe() {
    const { language, setLanguage, t } = useTranslationStore()
    return (
        <CustomSelect
            aria-label={t('language.label')}
            value={language}
            options={AVAILABLE_LANGUAGES.map((value) => ({
                value,
                label: t(`language.names.${value}`),
            }))}
            renderOption={(option) => renderLanguage(option.value, option.label)}
            renderValue={(selected) => {
                const option = selected[0]
                return option ? renderLanguage(option.value, option.label) : null
            }}
            onValueChange={(value) => {
                if (isAppLanguage(value)) void setLanguage?.(value)
            }}
        />
    )
}

function NativeErrorProbe() {
    const { t } = useTranslationStore()
    return (
        <PasswordInput
            id="native-error"
            aria-label="Password"
            value=""
            onChange={() => undefined}
            error={getFieldErrorMessage([getValidationIssue(emailSchema, '')], t)}
        />
    )
}

function LocalizedControlsProbe() {
    const { language, t, inputMessages, selectMessages } = useControlLocalization()
    return (
        <InputProvider locale={language} messages={inputMessages}>
            <SelectProvider locale="en" messages={selectMessages}>
                <PasswordInput aria-label="Test password" value="" onChange={() => undefined} />
                <CustomSelect<string>
                    aria-label="Test selection"
                    placeholder={t('validation.selectOption')}
                    value=""
                    options={[]}
                    onValueChange={() => undefined}
                />
            </SelectProvider>
        </InputProvider>
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
    test.each(['it', 'pt', 'nl', 'pl'] as const)(
        'localizes password controls and empty select messages in %s',
        async (language) => {
            const container = await render(
                withTestLanguage(
                    <TooltipProvider>
                        <LocalizedControlsProbe />
                    </TooltipProvider>,
                    language,
                ),
            )
            expect(
                container.querySelector(
                    `button[aria-label="${catalogs[language].common.showPassword}"]`,
                ),
            ).not.toBeNull()
            const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
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
            expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
                catalogs[language].calendar.noOptions,
            )
            expect(document.documentElement.lang).toBe(language)
        },
    )

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
        expect(dropdown).toContain('flag:DE')
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
                    <NativeErrorProbe />
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
        expect(container.querySelector('#native-error-error')?.textContent).toBe(
            'Dieses Feld ist erforderlich.',
        )
        expect(container.querySelector('#native-error')?.getAttribute('aria-invalid')).toBe('true')
        expect(
            container.querySelector('#native-error')?.getAttribute('aria-describedby'),
        ).toContain('native-error-error')
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
            'Du hast keine Berechtigung für diese Änderung.',
        )
        expect(container.textContent).not.toContain('This field is required.')
    })

    test('shows every supported flag and keeps the selected flag after switching', async () => {
        const container = await render(withTestLanguage(<PickerProbe />))
        const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
        expect(trigger.querySelector('[class*="flag:GB"]')).not.toBeNull()
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
        expect(options.length).toBe(AVAILABLE_LANGUAGES.length)
        for (const language of AVAILABLE_LANGUAGES) {
            expect(
                options.some((option) =>
                    option.querySelector(`[class*="flag:${LANGUAGE_COUNTRY_CODES[language]}"]`),
                ),
            ).toBe(true)
        }
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
        expect(trigger.querySelector('[class*="flag:DE"]')).not.toBeNull()
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
                        <PasswordInput
                            id="public-password"
                            aria-label="Password"
                            locale="en"
                            value=""
                            onChange={() => {}}
                        />
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
