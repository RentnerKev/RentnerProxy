import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import { accessPolicyManagementQueryKeys } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import disableMotionAnimations from '@/tests/Helpers/disableMotionAnimations.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
disableMotionAnimations()

const createAccessPolicyHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'admin.accessPolicies.messages.created',
    runtimeStatus: 'applied',
}))
const updateAccessPolicyHandlerMock = mock(async (_input: unknown) => ({
    success: true,
    message: 'admin.accessPolicies.messages.updated',
    runtimeStatus: 'applied',
}))

mock.module('@/features/Admin/AccessPolicyManagement/middleware.ts', () => ({
    createAccessPolicyHandler: createAccessPolicyHandlerMock,
    updateAccessPolicyHandler: updateAccessPolicyHandlerMock,
}))

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { toast } = await import('@rentnerkev/toasts/toast')
const { default: AccessPolicyFormModal } =
    await import('@/features/Admin/AccessPolicyManagement/Components/AccessPolicyFormModal/index.tsx')

let root: Root | null = null
let queryClient: InstanceType<typeof QueryClient> | null = null

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement('div')
    document.body.append(container)
    queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    root = createRoot(container)
    await act(async () => {
        root?.render(
            withTestLanguage(
                <TooltipProvider>
                    <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                        <QueryClientProvider client={queryClient!}>{element}</QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
    })
    return container
}

async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + 2_000
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error('UI did not reach the expected state')
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each poll observes the next React render.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15))
        })
    }
}

function getButton(label: string): HTMLButtonElement {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) =>
            candidate.textContent?.trim().includes(label) ||
            candidate.getAttribute('aria-label') === label,
    )
    expect(button).toBeDefined()
    return button!
}

function getRadio(labelText: string): HTMLInputElement {
    const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find((candidate) =>
        candidate.textContent?.includes(labelText),
    )
    expect(label).toBeDefined()
    const inputId = label!.htmlFor
    const input = document.getElementById(inputId)
    expect(input).not.toBeNull()
    return input as HTMLInputElement
}

async function click(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}

async function chooseSelectOption(ariaLabel: string, optionLabel: string): Promise<void> {
    const trigger = getButton(ariaLabel)
    await act(async () => {
        trigger.dispatchEvent(
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
        (candidate) => candidate.textContent?.trim() === optionLabel,
    )
    expect(option).toBeDefined()
    await click(option!)
    await waitFor(() => document.querySelector('[role="listbox"]') === null)
}

async function setControlValue(
    control: HTMLInputElement | HTMLTextAreaElement,
    value: string,
): Promise<void> {
    await act(async () => {
        const prototype =
            control instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

function formModal(policy?: AccessPolicySummary, onSuccess = () => undefined) {
    return (
        <AccessPolicyFormModal
            open
            mode={policy ? 'edit' : 'create'}
            policy={policy}
            onOpenChange={() => undefined}
            onSuccess={onSuccess}
        />
    )
}

beforeEach(() => {
    toast.dismissAll()
    createAccessPolicyHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.accessPolicies.messages.created',
        runtimeStatus: 'applied',
    })
    updateAccessPolicyHandlerMock.mockReset().mockResolvedValue({
        success: true,
        message: 'admin.accessPolicies.messages.updated',
        runtimeStatus: 'applied',
    })
})

afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    queryClient?.clear()
    queryClient = null
    document.body.replaceChildren()
})

test('selects Authentik Forward Auth and saves the gateway path and identity headers', async () => {
    await render(formModal())
    await setControlValue(document.querySelector<HTMLInputElement>('input[name="name"]')!, 'SSO')
    await chooseSelectOption('Protection mode', 'Authenticated')
    await click(getRadio('Forward Auth'))
    await chooseSelectOption('Provider preset', 'Authentik')

    expect(
        document.querySelector<HTMLInputElement>('input[name="forwardAuth.gatewayPathPrefix"]')
            ?.value,
    ).toBe('/outpost.goauthentik.io/')
    expect(
        document.querySelector<HTMLTextAreaElement>('textarea[name="forwardAuth.responseHeaders"]')
            ?.value,
    ).toBe('X-Authentik-Username\nX-Authentik-Email')

    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="forwardAuth.endpoint"]')!,
        'http://auth.internal/outpost.goauthentik.io/auth/caddy/',
    )
    await click(getButton('Create access policy'))
    await waitFor(() => createAccessPolicyHandlerMock.mock.calls.length === 1)

    expect(createAccessPolicyHandlerMock.mock.calls[0]?.[0]).toMatchObject({
        data: {
            name: 'SSO',
            mode: 'authenticated',
            combination: null,
            forwardAuth: {
                provider: 'authentik',
                endpoint: 'http://auth.internal/outpost.goauthentik.io/auth/caddy/',
                timeoutSeconds: 5,
                gatewayPathPrefix: '/outpost.goauthentik.io/',
                requestHeaders: ['Cookie'],
                responseHeaders: ['X-Authentik-Email', 'X-Authentik-Username'],
            },
        },
    })
})

test('forces combined Forward Auth policies to use all checks', async () => {
    await render(formModal())
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="name"]')!,
        'SSO + IP',
    )
    await chooseSelectOption('Protection mode', 'Combined')
    await click(getRadio('Forward Auth'))

    const combinationOptions = document.querySelectorAll<HTMLInputElement>(
        'input[name="combination"]',
    )
    expect(combinationOptions).toHaveLength(1)
    expect(combinationOptions[0]?.checked).toBe(true)
})

const basicAuthPolicy: AccessPolicySummary = {
    id: '0198d98a-0000-7000-8000-000000000001',
    name: 'Protected site',
    description: '',
    mode: 'authenticated',
    combination: null,
    ipRules: null,
    forwardAuth: null,
    assignedHostCount: 1,
    basicAuthAccountCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

async function enterBasicAuthCredentials(): Promise<void> {
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="username"]')!,
        'kevin',
    )
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="password"]')!,
        '  unchanged password  ',
    )
}

test('creates Basic Auth with the policy in a single save and preserves the entered password', async () => {
    await render(formModal())
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="name"]')!,
        'Protected site',
    )
    expect(document.querySelector('input[name="password"]')).toBeNull()
    await chooseSelectOption('Protection mode', 'Authenticated')
    expect(document.querySelector<HTMLInputElement>('input[name="password"]')?.type).toBe(
        'password',
    )
    await enterBasicAuthCredentials()
    expect(document.body.textContent).toContain('Basic Auth will be configured')
    await click(getButton('Create access policy'))
    await waitFor(() => createAccessPolicyHandlerMock.mock.calls.length === 1)
    expect(createAccessPolicyHandlerMock.mock.calls[0]?.[0]).toEqual({
        data: {
            name: 'Protected site',
            mode: 'authenticated',
            combination: null,
            ipRules: null,
            forwardAuth: null,
            basicAuth: { username: 'kevin', password: '  unchanged password  ' },
        },
    })
    expect(updateAccessPolicyHandlerMock).not.toHaveBeenCalled()
})

test('requires both credentials before saving a Basic Auth policy', async () => {
    await render(formModal())
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="name"]')!,
        'Protected site',
    )
    await chooseSelectOption('Protection mode', 'Authenticated')
    await click(getButton('Create access policy'))
    expect(createAccessPolicyHandlerMock).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Enter a username.')
    expect(document.body.textContent).toContain('Enter a password.')
    await setControlValue(
        document.querySelector<HTMLInputElement>('input[name="username"]')!,
        'invalid:user',
    )
    await click(getButton('Create access policy'))
    expect(createAccessPolicyHandlerMock).not.toHaveBeenCalled()
    expect(
        document
            .querySelector<HTMLInputElement>('input[name="username"]')
            ?.getAttribute('aria-invalid'),
    ).toBe('true')
})

test('sets up the first Basic Auth account while editing an existing policy', async () => {
    await render(formModal(basicAuthPolicy))
    const accountsKey = accessPolicyManagementQueryKeys.basicAuthAccounts(basicAuthPolicy.id)
    queryClient!.setQueryData(accountsKey, [])
    expect(queryClient!.getQueryState(accountsKey)?.isInvalidated).toBe(false)
    await enterBasicAuthCredentials()
    await click(getButton('Save'))
    await waitFor(() => updateAccessPolicyHandlerMock.mock.calls.length === 1)
    expect(updateAccessPolicyHandlerMock.mock.calls[0]?.[0]).toMatchObject({
        data: {
            accessPolicyId: basicAuthPolicy.id,
            mode: 'authenticated',
            basicAuth: { username: 'kevin', password: '  unchanged password  ' },
        },
    })
    expect(createAccessPolicyHandlerMock).not.toHaveBeenCalled()
    await waitFor(() => queryClient!.getQueryState(accountsKey)?.isInvalidated === true)
})

test('preserves existing Basic Auth accounts when editing the policy', async () => {
    await render(formModal({ ...basicAuthPolicy, basicAuthAccountCount: 1 }))
    expect(document.querySelector('input[name="password"]')).toBeNull()
    expect(document.body.textContent).toContain('The saved credentials remain active.')
    await click(getButton('Save'))
    await waitFor(() => updateAccessPolicyHandlerMock.mock.calls.length === 1)
    expect(updateAccessPolicyHandlerMock.mock.calls[0]?.[0]).toEqual({
        data: {
            accessPolicyId: basicAuthPolicy.id,
            name: basicAuthPolicy.name,
            mode: 'authenticated',
            combination: null,
            ipRules: null,
            forwardAuth: null,
        },
    })
})

test('excludes drafted credentials when switching back to a public policy', async () => {
    await render(formModal(basicAuthPolicy))
    await enterBasicAuthCredentials()
    await chooseSelectOption('Protection mode', 'Public')
    expect(document.querySelector('input[name="password"]')).toBeNull()
    await click(getButton('Save'))
    await waitFor(() => updateAccessPolicyHandlerMock.mock.calls.length === 1)
    expect(updateAccessPolicyHandlerMock.mock.calls[0]?.[0]).toEqual({
        data: {
            accessPolicyId: basicAuthPolicy.id,
            name: basicAuthPolicy.name,
            mode: 'public',
            combination: null,
            ipRules: null,
            forwardAuth: null,
        },
    })
})

test('keeps the setup open with an error when saving fails', async () => {
    const onSuccess = mock(() => undefined)
    updateAccessPolicyHandlerMock.mockResolvedValue({
        success: false,
        message: 'admin.accessPolicies.errors.saveFailed',
        runtimeStatus: 'pending',
    })
    await render(formModal(basicAuthPolicy, onSuccess))
    await enterBasicAuthCredentials()
    await click(getButton('Save'))
    await waitFor(() => document.body.textContent?.includes('could not be saved') === true)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLInputElement>('input[name="username"]')?.value).toBe('kevin')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

test('reports saved configuration as pending when runtime application is unavailable', async () => {
    updateAccessPolicyHandlerMock.mockResolvedValue({
        success: true,
        message: 'admin.accessPolicies.messages.savedPending',
        runtimeStatus: 'pending',
    })
    await render(formModal(basicAuthPolicy))
    await enterBasicAuthCredentials()
    await click(getButton('Save'))
    await waitFor(
        () =>
            document.body.textContent?.includes(
                'Saved access policy changes are waiting to be applied.',
            ) === true,
    )
    expect(document.body.textContent).not.toContain('Access policy updated successfully')
})
