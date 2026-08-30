import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register()
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: SecuritySection } =
    await import('../features/Auth/Account/Components/SecuritySection')

let activeRoot: Root | null = null

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

afterEach(async () => {
    await act(async () => {
        activeRoot?.unmount()
    })
    activeRoot = null
    document.body.replaceChildren()
})

beforeEach(() => {
    document.body.replaceChildren()
})

describe('account security section', () => {
    test('shows enable controls when TOTP is disabled', async () => {
        const onEnableTotp = mock(() => {})
        const container = await render(
            <SecuritySection
                status={{
                    totpEnabled: false,
                    recoveryCodesRemaining: 0,
                    passkeys: [],
                    recentlyAuthenticated: true,
                }}
                isLoading={false}
                isPending={false}
                onEnableTotp={onEnableTotp}
                onAddPasskey={() => {}}
                onDisableTotp={() => {}}
                onRegenerateCodes={() => {}}
                onRenamePasskey={() => {}}
                onRemovePasskey={() => {}}
            />,
        )

        expect(container.textContent).toContain('Disabled')
        expect(container.textContent).toContain('Enable two-factor authentication')
        expect(container.textContent).not.toContain('Regenerate recovery codes')

        await click(
            Array.from(container.querySelectorAll('button')).find(
                (button) => button.textContent === 'Enable two-factor authentication',
            )!,
        )
        expect(onEnableTotp).toHaveBeenCalledTimes(1)
    })

    test('renders passkeys and routes rename/remove actions by credential id', async () => {
        const onRenamePasskey = mock((_id: string) => {})
        const onRemovePasskey = mock((_id: string) => {})
        const container = await render(
            <SecuritySection
                status={{
                    totpEnabled: true,
                    recoveryCodesRemaining: 8,
                    recentlyAuthenticated: true,
                    passkeys: [
                        {
                            id: 'passkey-1',
                            name: 'Office laptop',
                            createdAt: '2026-08-29T10:00:00.000Z',
                            lastUsedAt: null,
                        },
                    ],
                }}
                isLoading={false}
                isPending={false}
                onEnableTotp={() => {}}
                onAddPasskey={() => {}}
                onDisableTotp={() => {}}
                onRegenerateCodes={() => {}}
                onRenamePasskey={onRenamePasskey}
                onRemovePasskey={onRemovePasskey}
            />,
        )

        expect(container.textContent).toContain('Office laptop')
        expect(container.textContent).toContain('Recovery codes available: 8')

        const buttons = Array.from(container.querySelectorAll('button'))
        await click(buttons.find((button) => button.textContent === 'Rename')!)
        await click(buttons.find((button) => button.textContent === 'Remove')!)

        expect(onRenamePasskey).toHaveBeenCalledWith('passkey-1')
        expect(onRemovePasskey).toHaveBeenCalledWith('passkey-1')
    })
})
