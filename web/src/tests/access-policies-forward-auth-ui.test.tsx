import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { TOAST_PROVIDER_PROPS } from '../config/toast.config'
import type { AccessPolicySummary } from '../shared/Types/access-policies.types'
import disableMotionAnimations from './Helpers/disableMotionAnimations'
import withTestLanguage from './Helpers/withTestLanguage'

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

mock.module('../features/Admin/AccessPolicyManagement/server', () => ({
    createAccessPolicyHandler: createAccessPolicyHandlerMock,
    updateAccessPolicyHandler: updateAccessPolicyHandlerMock,
}))

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('@rentnerkev/tooltips/tooltip')
const { ToastProvider } = await import('@rentnerkev/toasts')
const { default: AccessPolicyFormModal } =
    await import('../features/Admin/AccessPolicyManagement/Components/AccessPolicyFormModal')

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

function formModal(policy?: AccessPolicySummary) {
    return (
        <AccessPolicyFormModal
            open
            mode={policy ? 'edit' : 'create'}
            policy={policy}
            onOpenChange={() => undefined}
            onSuccess={() => undefined}
        />
    )
}

beforeEach(() => {
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
