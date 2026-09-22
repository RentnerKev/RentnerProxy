import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { TOAST_PROVIDER_PROPS } from '../config/toast.config'
import {
    AuthenticatedLanguageProvider,
    type AppLanguage,
    default as useTranslationStore,
} from '../language/useTranslationStore'
import { bootstraps, default as withTestLanguage } from './Helpers/withTestLanguage'
import disableMotionAnimations from './Helpers/disableMotionAnimations'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const { ToastProvider } = await import('@rentnerkev/toasts')
const { toast } = await import('@rentnerkev/toasts/toast')
const { act, useMemo, useState } = await import('react')
const { createRoot } = await import('react-dom/client')

let activeRoot: Root | null = null

const writeClipboardText = mock(async (_message: string): Promise<void> => {})
const ENGLISH_TOAST_MESSAGES = {
    regionLabel: 'Notification',
    closeNotification: 'Dismiss notification',
    copyError: 'Copy error message',
    errorCopied: 'Copied',
} as const

function ToastButtons({
    prefix,
    onSwitchLanguage,
}: {
    readonly prefix: string
    readonly onSwitchLanguage?: () => void
}) {
    const { t } = useTranslationStore()

    return (
        <div data-testid={`${prefix}-controls`}>
            <button
                type="button"
                data-testid={`${prefix}-one`}
                onClick={() =>
                    toast.success(t('account.password.success.changed'), {
                        title: t('toast.titles.success'),
                    })
                }
            >
                Show one
            </button>
            <button
                type="button"
                data-testid={`${prefix}-two`}
                onClick={() =>
                    toast.info(t('account.profileImage.success.updated'), {
                        title: t('toast.titles.info'),
                    })
                }
            >
                Show two
            </button>
            <button
                type="button"
                data-testid={`${prefix}-three`}
                onClick={() =>
                    toast.warning(t('account.twoFactor.success.disabled'), {
                        title: t('toast.titles.warning'),
                    })
                }
            >
                Show three
            </button>
            <button
                type="button"
                data-testid={`${prefix}-four`}
                onClick={() =>
                    toast.error(t('account.passkeys.error.registrationFailed'), {
                        title: t('toast.titles.error'),
                    })
                }
            >
                Show four
            </button>
            <button
                type="button"
                data-testid={`${prefix}-short`}
                onClick={() =>
                    toast.success(t('account.password.success.changed'), {
                        title: t('toast.titles.success'),
                        duration: 40,
                    })
                }
            >
                Show short
            </button>
            {onSwitchLanguage ? (
                <button type="button" data-testid={`${prefix}-switch`} onClick={onSwitchLanguage}>
                    Switch language
                </button>
            ) : null}
        </div>
    )
}

function LocalizedToastSurface({ onSwitchLanguage }: { readonly onSwitchLanguage: () => void }) {
    const { language, t } = useTranslationStore()
    const messages = useMemo(
        () => ({
            regionLabel: t('toast.notification'),
            closeNotification: t('toast.dismiss'),
            copyError: t('toast.copyError'),
            errorCopied: t('toast.copied'),
        }),
        [t],
    )

    return (
        <ToastProvider
            {...TOAST_PROVIDER_PROPS}
            locale={language === 'de' ? 'de' : 'en'}
            messages={messages}
        >
            <ToastButtons prefix="language" onSwitchLanguage={onSwitchLanguage} />
        </ToastProvider>
    )
}

function LanguageToastHarness() {
    const [language, setLanguage] = useState<AppLanguage>('en')

    return (
        <AuthenticatedLanguageProvider bootstrap={bootstraps[language]}>
            <LocalizedToastSurface onSwitchLanguage={() => setLanguage('de')} />
        </AuthenticatedLanguageProvider>
    )
}

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    activeRoot = createRoot(container)

    await act(async () => {
        activeRoot?.render(element)
    })

    return container
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition() && Date.now() < deadline) {
        // oxlint-disable-next-line no-await-in-loop -- Poll one rendered state at a time inside act.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
        })
    }
    expect(condition()).toBe(true)
}

function getToastNodes(container: Element): Array<HTMLElement> {
    return [...container.querySelectorAll<HTMLElement>('.rentnerproxy-toast')]
}

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    toast.dismissAll()
    document.body.replaceChildren()
})

beforeEach(() => {
    toast.dismissAll()
    document.body.replaceChildren()
    writeClipboardText.mockReset()
    writeClipboardText.mockResolvedValue(undefined)
})

describe('RentnerToasts integration', () => {
    test('shows at most three notifications with a localized title and body', async () => {
        const container = await render(
            withTestLanguage(
                <ToastProvider
                    {...TOAST_PROVIDER_PROPS}
                    locale="en"
                    messages={ENGLISH_TOAST_MESSAGES}
                >
                    <ToastButtons prefix="limit" />
                </ToastProvider>,
            ),
        )

        await click(container.querySelector('[data-testid="limit-one"]')!)
        await click(container.querySelector('[data-testid="limit-two"]')!)
        await click(container.querySelector('[data-testid="limit-three"]')!)
        await click(container.querySelector('[data-testid="limit-four"]')!)
        await waitFor(() => getToastNodes(container).length === 3)

        const messages = getToastNodes(container).map((node) => node.textContent ?? '')
        expect(messages.some((message) => message.includes('Password changed.'))).toBeFalse()
        expect(messages.some((message) => message.includes('Information'))).toBeTrue()
        expect(messages.some((message) => message.includes('Profile picture updated.'))).toBeTrue()
        expect(messages.some((message) => message.includes('Please note'))).toBeTrue()
        expect(messages.some((message) => message.includes('Action failed'))).toBeTrue()
        expect(
            messages.some((message) => message.includes('Passkey registration failed.')),
        ).toBeTrue()
    })

    test('uses the active language for both newly created toast titles and bodies', async () => {
        const container = await render(<LanguageToastHarness />)

        await click(container.querySelector('[data-testid="language-one"]')!)
        expect(container.textContent).toContain('Success')
        expect(container.textContent).toContain('Password changed. Other sessions were revoked.')

        await click(container.querySelector('[data-testid="language-switch"]')!)
        await click(container.querySelector('[data-testid="language-one"]')!)
        await waitFor(() => container.textContent?.includes('Erfolgreich') ?? false)
        expect(container.textContent).toContain('Passwort geändert.')
    })

    test('dismisses a toast and automatically removes short messages', async () => {
        const container = await render(
            withTestLanguage(
                <ToastProvider
                    {...TOAST_PROVIDER_PROPS}
                    locale="en"
                    messages={ENGLISH_TOAST_MESSAGES}
                >
                    <ToastButtons prefix="dismiss" />
                </ToastProvider>,
            ),
        )

        await click(container.querySelector('[data-testid="dismiss-one"]')!)
        const toastNode = getToastNodes(container)[0]
        expect(toastNode?.textContent).toContain('Success')
        expect(toastNode?.textContent).toContain('Password changed.')

        const close = toastNode?.querySelector<HTMLButtonElement>(
            '[aria-label="Dismiss notification"]',
        )
        expect(close).not.toBeNull()
        await click(close!)
        await waitFor(() => getToastNodes(container).length === 0)

        await click(container.querySelector('[data-testid="dismiss-short"]')!)
        expect(getToastNodes(container)).toHaveLength(1)
        await waitFor(() => getToastNodes(container).length === 0, 1_000)
    })

    test('announces errors and copies their title together with the body', async () => {
        const originalClipboard = navigator.clipboard
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: writeClipboardText },
        })

        try {
            const container = await render(
                withTestLanguage(
                    <ToastProvider
                        {...TOAST_PROVIDER_PROPS}
                        locale="en"
                        messages={ENGLISH_TOAST_MESSAGES}
                    >
                        <ToastButtons prefix="error" />
                    </ToastProvider>,
                ),
            )
            await click(container.querySelector('[data-testid="error-four"]')!)

            expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
                'Notification',
            )
            const errorToast = container.querySelector<HTMLElement>(
                '.rentnerproxy-toast-error[role="alert"]',
            )
            expect(errorToast?.textContent).toContain('Action failed')
            expect(errorToast?.textContent).toContain('Passkey registration failed.')

            const copyButton = errorToast?.querySelector<HTMLButtonElement>(
                '[aria-label="Copy error message"]',
            )
            expect(copyButton).not.toBeNull()
            await click(copyButton!)
            await waitFor(() => copyButton?.getAttribute('aria-label') === 'Copied')
            expect(writeClipboardText).toHaveBeenCalledWith(
                'Action failed\nPasskey registration failed.',
            )
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: originalClipboard,
            })
        }
    })
})
