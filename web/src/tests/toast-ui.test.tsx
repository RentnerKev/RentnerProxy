import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { AuthenticatedLanguageProvider, type AppLanguage } from '../language/useTranslationStore'
import { bootstraps, default as withTestLanguage } from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')
const { default: useToast } = await import('../shared/Toast/Hooks/useToast')
const { TooltipProvider } = await import('../shared/Tooltip')

let activeRoot: Root | null = null

const writeClipboardText = mock(async (_message: string): Promise<void> => {})

function ToastButtons({
    prefix,
    onSwitchLanguage,
}: {
    readonly prefix: string
    readonly onSwitchLanguage?: () => void
}) {
    const notifications = useToast()

    return (
        <div data-testid={`${prefix}-controls`}>
            <button
                type="button"
                data-testid={`${prefix}-one`}
                onClick={() => notifications.success('account.password.success.changed')}
            >
                Show one
            </button>
            <button
                type="button"
                data-testid={`${prefix}-two`}
                onClick={() => notifications.info('account.profileImage.success.updated')}
            >
                Show two
            </button>
            <button
                type="button"
                data-testid={`${prefix}-three`}
                onClick={() => notifications.warning('account.twoFactor.success.disabled')}
            >
                Show three
            </button>
            <button
                type="button"
                data-testid={`${prefix}-four`}
                onClick={() => notifications.error('account.passkeys.error.registrationFailed')}
            >
                Show four
            </button>
            <button
                type="button"
                data-testid={`${prefix}-short`}
                onClick={() =>
                    notifications.success('account.password.success.changed', { duration: 40 })
                }
            >
                Show short
            </button>
            <button
                type="button"
                data-testid={`${prefix}-pause`}
                onClick={() =>
                    notifications.success('account.password.success.changed', { duration: 120 })
                }
            >
                Show pausing message
            </button>
            {onSwitchLanguage ? (
                <button type="button" data-testid={`${prefix}-switch`} onClick={onSwitchLanguage}>
                    Switch language
                </button>
            ) : null}
        </div>
    )
}

function LanguageToastHarness() {
    const [language, setLanguage] = useState<AppLanguage>('en')

    return (
        <AuthenticatedLanguageProvider bootstrap={bootstraps[language]}>
            <TooltipProvider>
                <ToastProvider>
                    <ToastButtons prefix="language" onSwitchLanguage={() => setLanguage('de')} />
                </ToastProvider>
            </TooltipProvider>
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
    return [...container.querySelectorAll<HTMLElement>('[data-toast-tone]')]
}

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    document.body.replaceChildren()
})

beforeEach(() => {
    document.body.replaceChildren()
    writeClipboardText.mockReset()
    writeClipboardText.mockResolvedValue(undefined)
})

describe('toast UI', () => {
    test('shows at most three notifications and keeps providers isolated', async () => {
        const container = await render(
            withTestLanguage(
                <TooltipProvider>
                    <div>
                        <section data-testid="first-provider">
                            <ToastProvider>
                                <ToastButtons prefix="first" />
                            </ToastProvider>
                        </section>
                        <section data-testid="second-provider">
                            <ToastProvider>
                                <ToastButtons prefix="second" />
                            </ToastProvider>
                        </section>
                    </div>
                </TooltipProvider>,
            ),
        )

        await click(container.querySelector('[data-testid="first-one"]')!)
        await click(container.querySelector('[data-testid="first-two"]')!)
        await click(container.querySelector('[data-testid="first-three"]')!)
        await click(container.querySelector('[data-testid="first-four"]')!)
        await click(container.querySelector('[data-testid="second-one"]')!)

        const firstProvider = container.querySelector('[data-testid="first-provider"]')!
        const secondProvider = container.querySelector('[data-testid="second-provider"]')!
        expect(getToastNodes(firstProvider)).toHaveLength(3)
        const firstMessages = getToastNodes(firstProvider).map((toast) => toast.textContent ?? '')
        expect(
            firstMessages.some((message) => message.includes('Profile picture updated.')),
        ).toBeTrue()
        expect(
            firstMessages.some((message) =>
                message.includes('Two-factor authentication disabled.'),
            ),
        ).toBeTrue()
        expect(getToastNodes(secondProvider)).toHaveLength(1)
        expect(getToastNodes(secondProvider)[0]?.textContent).toContain(
            'Password changed. Other sessions were revoked.',
        )
    })

    test('updates an already visible message when the authenticated language changes', async () => {
        const container = await render(<LanguageToastHarness />)

        await click(container.querySelector('[data-testid="language-one"]')!)
        expect(container.textContent).toContain('Password changed. Other sessions were revoked.')

        await click(container.querySelector('[data-testid="language-switch"]')!)
        await waitFor(() => container.textContent?.includes('Passwort geändert.') ?? false)
    })

    test('dismisses a notification from its close button and automatically removes short messages', async () => {
        const container = await render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider>
                        <ToastButtons prefix="dismiss" />
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )

        await click(container.querySelector('[data-testid="dismiss-one"]')!)
        const toast = getToastNodes(container)[0]
        expect(toast).toBeDefined()
        const close = toast?.querySelector('button')
        expect(close).not.toBeNull()
        await click(close!)
        await waitFor(() => getToastNodes(container).length === 0)

        await click(container.querySelector('[data-testid="dismiss-short"]')!)
        expect(getToastNodes(container)).toHaveLength(1)
        await waitFor(() => getToastNodes(container).length === 0, 1_000)
    })

    test('pauses expiry for hover and keyboard focus before resuming the countdown', async () => {
        const container = await render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider>
                        <ToastButtons prefix="pause" />
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
        const trigger = container.querySelector<HTMLButtonElement>('[data-testid="pause-pause"]')!
        await click(trigger)
        const viewport = container.querySelector<HTMLElement>('[data-toast-viewport]')!
        const toast = getToastNodes(container)[0]!
        const progress = toast.querySelector<HTMLElement>('[aria-hidden="true"][style]')!

        await act(async () => {
            toast.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        })
        expect(progress.style.animationPlayState).toBe('paused')
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 160))
        })
        expect(getToastNodes(container)).toHaveLength(1)

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', code: 'F8' }))
        })
        expect(document.activeElement).toBe(viewport)
        await act(async () => {
            viewport.parentElement?.dispatchEvent(new PointerEvent('pointerleave'))
            await new Promise((resolve) => setTimeout(resolve, 160))
        })
        expect(getToastNodes(container)).toHaveLength(1)
        expect(progress.style.animationPlayState).toBe('paused')

        await act(async () => {
            trigger.focus()
        })
        expect(progress.style.animationPlayState).toBe('running')
        await waitFor(() => getToastNodes(container).length === 0)
    })

    test('announces and copies the visible error, and handles clipboard denial', async () => {
        const originalClipboard = navigator.clipboard
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: writeClipboardText },
        })

        try {
            const container = await render(
                withTestLanguage(
                    <TooltipProvider>
                        <ToastProvider>
                            <ToastButtons prefix="error" />
                        </ToastProvider>
                    </TooltipProvider>,
                ),
            )
            await click(container.querySelector('[data-testid="error-four"]')!)
            expect(container.querySelector('[data-toast-viewport]')).not.toBeNull()
            expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe(
                'Notifications (F8)',
            )
            await waitFor(
                () =>
                    document
                        .querySelector('[aria-live="assertive"]')
                        ?.textContent?.includes('Passkey registration failed.') ?? false,
            )

            const errorToast = container.querySelector('[data-toast-tone="error"]')!
            const copyButton = errorToast.querySelector<HTMLButtonElement>('button')!
            await click(copyButton)
            await waitFor(() => copyButton.getAttribute('aria-label') === 'Copied')
            expect(writeClipboardText).toHaveBeenCalledWith(
                'Action failed\nPasskey registration failed.',
            )

            writeClipboardText.mockRejectedValueOnce(new Error('Clipboard access denied'))
            await click(copyButton)
            await waitFor(
                () =>
                    errorToast.querySelector('output')?.textContent ===
                    'Could not copy. Select the message to copy it.',
            )
            expect(getToastNodes(container)).toHaveLength(1)
        } finally {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: originalClipboard,
            })
        }
    })
})
