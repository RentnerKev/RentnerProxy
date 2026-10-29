import { afterEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { securityQueryKeys } from '@/lib/UserSettings/userSettingsCache.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

mock.module('@/features/UserSettings/middleware.ts', () => ({
    getSecurityStatusHandler: () => new Promise(() => undefined),
    beginTotpSetupHandler: mock(),
    confirmTotpSetupHandler: mock(),
    disableTotpHandler: mock(),
    regenerateRecoveryCodesHandler: mock(),
    beginPasskeyRegistrationHandler: mock(),
    finishPasskeyRegistrationHandler: mock(),
    removePasskeyHandler: mock(),
    renamePasskeyHandler: mock(),
}))
const { default: useSecurityOperations } =
    await import('@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useSecurityOperations.ts')

let root: Root | undefined
let container: HTMLDivElement | undefined
const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
})

function Probe({ userId }: { readonly userId: string }) {
    const { state } = useSecurityOperations(userId)
    return <div>{state.status?.passkeys.map((passkey) => passkey.name).join(',') ?? 'Loading'}</div>
}

afterEach(async () => {
    await act(async () => root?.unmount())
    client.clear()
    container?.remove()
})

test('renders no previous identity metadata while the new identity query is pending', async () => {
    client.setQueryData(securityQueryKeys.status('alice'), {
        totpEnabled: true,
        recentlyAuthenticated: true,
        recoveryCodesRemaining: 7,
        passkeys: [
            {
                id: 'alice-key',
                name: 'Alice private laptop',
                createdAt: '2026-01-01',
                lastUsedAt: null,
            },
        ],
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () =>
        root!.render(
            <QueryClientProvider client={client}>
                <Probe key="alice" userId="alice" />
            </QueryClientProvider>,
        ),
    )
    expect(container.textContent).toContain('Alice private laptop')
    await act(async () =>
        root!.render(
            <QueryClientProvider client={client}>
                <Probe key="bob" userId="bob" />
            </QueryClientProvider>,
        ),
    )
    expect(container.textContent).toBe('Loading')
    expect(container.textContent).not.toContain('Alice')
})
