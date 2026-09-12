import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'

import {
    getAccessPolicyAvailability,
    getIpAccessRuleCount,
} from '../features/Admin/AccessPolicyManagement/Helpers/basicAuthPolicyState'
import {
    defaultAccessPolicyIpRules,
    parseAccessPolicyIpRulesDraft,
} from '../features/Admin/AccessPolicyManagement/Helpers/ipAccessPolicyState'
import type { AccessPolicySummary } from '../shared/Types/access-policies.types'
import withTestLanguage from './Helpers/withTestLanguage'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { TooltipProvider } = await import('../shared/Tooltip')
const { default: ToastProvider } = await import('../shared/Toast/Components/ToastProvider')

const createAccessPolicyHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.accessPolicies.messages.created',
    runtimeStatus: 'applied' as const,
}))
const updateAccessPolicyHandlerMock = mock(async (_input: unknown) => ({
    success: true as const,
    message: 'admin.accessPolicies.messages.updated',
    runtimeStatus: 'applied' as const,
}))

mock.module('../features/Admin/AccessPolicyManagement/server', () => ({
    createAccessPolicyHandler: createAccessPolicyHandlerMock,
    updateAccessPolicyHandler: updateAccessPolicyHandlerMock,
}))

const { default: AccessPolicyFormModal } =
    await import('../features/Admin/AccessPolicyManagement/Components/AccessPolicyFormModal')

const policy = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
    name: 'Office access',
    description: '',
    mode: 'ip-restricted' as const,
    combination: null,
    ipRules: {
        defaultAction: 'deny' as const,
        allow: ['192.0.2.0/24'],
        deny: ['192.0.2.128/25'],
    },
    assignedHostCount: 0,
    basicAuthAccountCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

let activeRoot: Root | null = null

async function renderForm(
    mode: 'create' | 'edit',
    existingPolicy: AccessPolicySummary | undefined = undefined,
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
                            <AccessPolicyFormModal
                                open
                                mode={mode}
                                onOpenChange={() => undefined}
                                onSuccess={() => undefined}
                                {...(existingPolicy ? { policy: existingPolicy } : {})}
                            />
                        </QueryClientProvider>
                    </ToastProvider>
                </TooltipProvider>,
            ),
        )
    })
}

async function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype =
        control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    await act(async () => {
        setter?.call(control, value)
        control.dispatchEvent(new Event('input', { bubbles: true }))
        control.dispatchEvent(new Event('change', { bubbles: true }))
        await Promise.resolve()
    })
}

async function chooseMode(label: string): Promise<void> {
    const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Protection mode"]',
    )
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
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.textContent?.trim() === label,
    )
    expect(option).not.toBeUndefined()
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
}

async function submitForm(): Promise<void> {
    const form = document.querySelector('form')
    expect(form).not.toBeNull()
    await act(async () => {
        form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await Promise.resolve()
        await Promise.resolve()
    })
}

beforeEach(() => {
    createAccessPolicyHandlerMock.mockClear()
    updateAccessPolicyHandlerMock.mockClear()
})

afterEach(() => {
    activeRoot?.unmount()
    activeRoot = null
    document.body.replaceChildren()
})

describe('IP access policy UI', () => {
    test('parses and canonicalizes one rule per line, with bounded invalid input', () => {
        expect(defaultAccessPolicyIpRules).toEqual({
            defaultAction: 'deny',
            allow: '',
            deny: '',
        })
        const parsed = parseAccessPolicyIpRulesDraft({
            defaultAction: 'deny',
            allow: '192.0.2.17/24\n2001:0DB8::1/64',
            deny: '192.0.2.128/25',
        })
        expect(parsed).toEqual({
            rules: {
                defaultAction: 'deny',
                allow: ['192.0.2.0/24', '2001:db8::/64'],
                deny: ['192.0.2.128/25'],
            },
        })
        expect(
            parseAccessPolicyIpRulesDraft({
                defaultAction: 'deny',
                allow: 'not-an-ip',
                deny: '',
            }),
        ).toEqual({
            error: 'admin.accessPolicies.validation.ipRulesInvalid',
            rules: null,
        })
    })

    test('shows actual provider readiness for public, IP, and combined AND/OR modes', () => {
        expect(getAccessPolicyAvailability('public', null, 0, null)).toBe('publicIgnored')
        expect(getAccessPolicyAvailability('ip-restricted', null, 0, null)).toBe(
            'ipRestrictedMissing',
        )
        expect(getAccessPolicyAvailability('ip-restricted', null, 0, policy.ipRules)).toBe(
            'ipRestrictedAvailable',
        )
        expect(
            getAccessPolicyAvailability('ip-restricted', null, 0, {
                defaultAction: 'deny',
                allow: [],
                deny: [],
            }),
        ).toBe('ipRestrictedBlocksAll')
        expect(getAccessPolicyAvailability('combined', 'all', 1, policy.ipRules)).toBe(
            'combinedAllAvailable',
        )
        expect(getAccessPolicyAvailability('combined', 'all', 0, policy.ipRules)).toBe(
            'combinedAllMissingAuth',
        )
        expect(getAccessPolicyAvailability('combined', 'all', 1, null)).toBe('combinedAllMissingIp')
        expect(getAccessPolicyAvailability('combined', 'any', 1, null)).toBe(
            'combinedAnyAvailableAuth',
        )
        expect(getAccessPolicyAvailability('combined', 'any', 0, policy.ipRules)).toBe(
            'combinedAnyAvailableIp',
        )
        expect(getAccessPolicyAvailability('combined', 'any', 1, policy.ipRules)).toBe(
            'combinedAnyAvailableBoth',
        )
    })

    test('defaults new IP access to deny and sends canonical CRUD payload', async () => {
        await renderForm('create')
        await chooseMode('IP restricted')
        const enabled = document.querySelector<HTMLInputElement>('input[name="ipRules.enabled"]')
        expect(enabled?.checked).toBe(false)
        await act(async () => {
            enabled?.click()
            await Promise.resolve()
        })
        expect(enabled?.checked).toBe(true)
        expect(
            document.querySelector<HTMLButtonElement>('button[aria-label="Default action"]')
                ?.textContent,
        ).toContain('Deny (recommended)')
        await setControlValue(
            document.querySelector<HTMLTextAreaElement>('textarea[name="ipRules.allow"]')!,
            '192.0.2.17/24',
        )
        await setControlValue(
            document.querySelector<HTMLTextAreaElement>('textarea[name="ipRules.deny"]')!,
            '192.0.2.128/25',
        )
        await setControlValue(
            document.querySelector<HTMLInputElement>('input[name="name"]')!,
            'Office',
        )
        await submitForm()
        expect(createAccessPolicyHandlerMock).toHaveBeenCalledWith({
            data: {
                name: 'Office',
                mode: 'ip-restricted',
                combination: null,
                ipRules: {
                    defaultAction: 'deny',
                    allow: ['192.0.2.0/24'],
                    deny: ['192.0.2.128/25'],
                },
            },
        })
        expect(getIpAccessRuleCount(policy.ipRules)).toBe(2)
    })

    test('keeps existing rules hidden across mode changes and blocks invalid saves', async () => {
        await renderForm('edit', policy)
        expect(
            document.querySelector<HTMLTextAreaElement>('textarea[name="ipRules.allow"]')?.value,
        ).toBe('192.0.2.0/24')
        await chooseMode('Public')
        expect(document.querySelector('textarea[name="ipRules.allow"]')).toBeNull()
        await chooseMode('IP restricted')
        expect(
            document.querySelector<HTMLTextAreaElement>('textarea[name="ipRules.allow"]')?.value,
        ).toBe('192.0.2.0/24')
        await setControlValue(
            document.querySelector<HTMLTextAreaElement>('textarea[name="ipRules.allow"]')!,
            'invalid address',
        )
        await submitForm()
        expect(updateAccessPolicyHandlerMock).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain(
            'Enter only valid IP addresses or CIDR networks, one per line.',
        )
    })
})
