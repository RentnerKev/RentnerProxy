import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import { getAccessPolicyTableActionItems } from '../features/Admin/AccessPolicyManagement/Helpers/accessPolicyTableActions'
import { validateBasicAuthAccount } from '../features/Admin/AccessPolicyManagement/Helpers/basicAuthValidation'
import type { BasicAuthAccount } from '../features/Admin/AccessPolicyManagement/Types/basic-auth.types'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('../shared/Tooltip')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')

const createBasicAuthAccountHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.accessPolicies.basicAuth.messages.created',
    runtimeStatus: 'applied' as const,
}))
const updateBasicAuthAccountHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.accessPolicies.basicAuth.messages.updated',
    runtimeStatus: 'applied' as const,
}))

mock.module('../features/Admin/AccessPolicyManagement/server', () => ({
    createBasicAuthAccountHandler: createBasicAuthAccountHandlerMock,
    updateBasicAuthAccountHandler: updateBasicAuthAccountHandlerMock,
}))

const { default: BasicAuthAccountFormModal } =
    await import('../features/Admin/AccessPolicyManagement/Components/BasicAuthAccountFormModal')

const account: BasicAuthAccount = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
    accessPolicyId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022',
    username: 'alice@example.com',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}
const policy = {
    id: account.accessPolicyId,
    name: 'Office',
    description: '',
    mode: 'authenticated' as const,
    combination: null,
    assignedHostCount: 0,
    basicAuthAccountCount: 1,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
}

let activeRoot: Root | null = null

async function renderAccountForm(
    mode: 'create' | 'edit',
    onSuccess = () => undefined,
): Promise<void> {
    const container = document.createElement('div')
    document.body.append(container)
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    activeRoot = createRoot(container)
    await act(async () => {
        activeRoot?.render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider>
                        <QueryClientProvider client={queryClient}>
                            <BasicAuthAccountFormModal
                                open
                                accessPolicyId={account.accessPolicyId}
                                account={mode === 'edit' ? account : undefined}
                                mode={mode}
                                onOpenChange={() => undefined}
                                onSuccess={onSuccess}
                            />
                        </QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
    })
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function submitForm(): Promise<void> {
    const form = document.querySelector('form')
    if (!form) throw new Error('form not found')
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await Promise.resolve()
        await Promise.resolve()
    })
}

async function waitFor(condition: () => boolean, timeoutMs = 1_500): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const waitUntil = async (): Promise<void> => {
        if (condition()) return
        if (Date.now() >= deadline) throw new Error('timed out waiting for UI state')
        await new Promise((resolve) => setTimeout(resolve, 10))
        await waitUntil()
    }
    await waitUntil()
}

beforeEach(() => {
    createBasicAuthAccountHandlerMock.mockClear()
    updateBasicAuthAccountHandlerMock.mockClear()
})

afterEach(() => {
    activeRoot?.unmount()
    activeRoot = null
    document.body.innerHTML = ''
})

describe('Basic Auth credential UI', () => {
    test('gates credential actions by view permission and keeps assigned CRUD controls separate', () => {
        const selected: string[] = []
        const items = getAccessPolicyTableActionItems(
            {
                canDelete: false,
                canUpdate: false,
                canViewCredentials: true,
                isPending: false,
                onCredentials: () => selected.push('credentials'),
                onDelete: () => selected.push('delete'),
                onEdit: () => selected.push('edit'),
                policy,
            },
            (key) => key,
        )
        expect(items.map(({ label }) => label)).toEqual([
            'admin.accessPolicies.basicAuth.actions.credentials',
        ])
        items[0]?.onSelect()
        expect(selected).toEqual(['credentials'])

        const hidden = getAccessPolicyTableActionItems(
            {
                canDelete: false,
                canUpdate: false,
                canViewCredentials: false,
                isPending: false,
                onCredentials: () => selected.push('hidden'),
                onDelete: () => undefined,
                onEdit: () => undefined,
                policy,
            },
            (key) => key,
        )
        expect(hidden).toHaveLength(0)
    })

    test('creates an account with a masked password and clears the form after success', async () => {
        let succeeded = false
        await renderAccountForm('create', () => {
            succeeded = true
        })
        const username = document.querySelector('input[name="username"]') as HTMLInputElement
        const password = document.querySelector('input[name="password"]') as HTMLInputElement
        expect(password.type).toBe('password')
        expect(password.autocomplete).toBe('new-password')
        await setInputValue(username, 'alice')
        await setInputValue(password, 'keep-this-secret')
        await submitForm()
        await waitFor(() => createBasicAuthAccountHandlerMock.mock.calls.length === 1)
        expect(createBasicAuthAccountHandlerMock.mock.calls[0]?.[0]).toEqual({
            data: {
                accessPolicyId: account.accessPolicyId,
                username: 'alice',
                password: 'keep-this-secret',
            },
        })
        await waitFor(() => succeeded)
        expect(password.value).toBe('')
    })

    test('edits a username without fetching or sending an existing password', async () => {
        await renderAccountForm('edit')
        const username = document.querySelector('input[name="username"]') as HTMLInputElement
        const password = document.querySelector('input[name="password"]') as HTMLInputElement
        expect(password.value).toBe('')
        await setInputValue(username, 'alice-renamed')
        await submitForm()
        await waitFor(() => updateBasicAuthAccountHandlerMock.mock.calls.length === 1)
        const submitted = updateBasicAuthAccountHandlerMock.mock.calls[0]?.[0] as {
            data: Record<string, unknown>
        }
        expect(submitted.data).toEqual({
            accessPolicyId: account.accessPolicyId,
            accountId: account.id,
            username: 'alice-renamed',
        })
        expect('password' in submitted.data).toBe(false)
    })

    test('allows a blank edit password but validates it for new accounts', () => {
        expect(validateBasicAuthAccount({ username: 'alice', password: '' }, 'edit')).toEqual({})
        expect(
            validateBasicAuthAccount({ username: 'alice', password: '' }, 'create').password,
        ).toBe('admin.accessPolicies.basicAuth.validation.passwordRequired')
        expect(
            validateBasicAuthAccount({ username: '-alice', password: 'secret' }, 'create').username,
        ).toBe('admin.accessPolicies.basicAuth.validation.usernameInvalid')
    })
})
