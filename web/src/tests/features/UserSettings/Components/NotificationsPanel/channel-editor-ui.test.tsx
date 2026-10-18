import { afterEach, describe, expect, test, mock } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type { Root } from 'react-dom/client'
import type { ChannelEditorProps } from '@/features/UserSettings/Components/NotificationsPanel/Types/notifications-panel.types.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: withTestLanguage } = await import('@/tests/Helpers/withTestLanguage.tsx')
const { default: ChannelEditor } =
    await import('@/features/UserSettings/Components/NotificationsPanel/Components/ChannelEditor.tsx')
const { default: DeliveryTable } =
    await import('@/features/UserSettings/Components/NotificationsPanel/Components/DeliveryTable.tsx')
const channel = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'My webhook',
    kind: 'webhook',
    revision: 3,
    enabled: true,
    events: ['ddns'],
    minimumSeverity: 'warning',
    thresholdSeconds: 10,
    recovery: true,
    destinationConfigured: true,
    hasAuthorization: true,
} as const
const settings: ChannelEditorProps['settings'] = {
    configuration: {
        version: 1,
        revision: 5,
        enabled: true,
        pausedAfterRestore: false,
        channels: [channel],
    },
    allowedCategories: ['ddns'],
    canResumeDelivery: false,
    canUsePrivateDestinations: false,
    smtpConfigured: true,
}
let root: Root | null = null
async function render(overrides: Partial<ChannelEditorProps> = {}) {
    const save = mock<ChannelEditorProps['onSave']>(async () => true)
    const props: ChannelEditorProps = {
        editor: { channel, revision: 5, channels: [channel] },
        settings,
        email: 'kevin@example.com',
        pending: false,
        onClose: () => {},
        onSave: save,
        ...overrides,
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(withTestLanguage(<ChannelEditor {...props} />))
    })
    return {
        save,
        props,
        rerender: async (next: ChannelEditorProps) =>
            act(async () => {
                root!.render(withTestLanguage(<ChannelEditor {...next} />))
            }),
    }
}
async function submit() {
    await act(async () => {
        document
            .querySelector('form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}
async function click(element: Element) {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await Promise.resolve()
    })
}
afterEach(async () => {
    await act(async () => root?.unmount())
    root = null
    document.body.replaceChildren()
})

describe('personal notification channel editor', () => {
    test('shows recovered incidents separately from delivery failures with usable row filters', async () => {
        const container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
        await act(async () => {
            root!.render(
                withTestLanguage(
                    <DeliveryTable
                        channels={[channel]}
                        status={{
                            incidents: [
                                {
                                    id: 'incident-1',
                                    category: 'ddns',
                                    resourceId: 'domain',
                                    severity: 'warning',
                                    startedAt: 1,
                                    observedAt: 2,
                                    failures: 1,
                                    recoveredAt: 3,
                                },
                            ],
                            deliveries: [
                                {
                                    id: 'delivery-1',
                                    incidentId: 'incident-1',
                                    channelId: channel.id,
                                    channelRevision: 3,
                                    type: 'incident',
                                    category: 'ddns',
                                    resourceId: 'domain',
                                    status: 'failed',
                                    attempts: 1,
                                    updatedAt: 4,
                                    error: 'timeout',
                                },
                            ],
                            pendingCount: 0,
                            deferredCount: 0,
                            saturationCount: 0,
                        }}
                    />,
                ),
            )
        })
        expect(container.querySelector('tbody')?.textContent).toContain('Recovered')
        expect(container.querySelector('tbody')?.textContent).toContain('Delivery failed')
        expect(container.querySelector('tbody')?.textContent).toContain('Delivery timed out')
        expect(container.querySelectorAll('thead th')).toHaveLength(5)
        expect(container.querySelector('table')?.className).toContain('table-fixed')
        const filter = container.querySelector('button[aria-controls]')!
        expect(filter).not.toBeNull()
        await click(filter)
        expect(filter.getAttribute('aria-expanded')).toBe('true')
        expect(container.querySelector('thead button')).not.toBeNull()
        expect(container.querySelector('nav[aria-label]')).not.toBeNull()
    })
    test('keeps saved destinations write-only and excludes summary fields on an unchanged save', async () => {
        const { save } = await render()
        expect(document.querySelector('input[type="password"]')).toBeNull()
        expect(document.body.textContent).toContain('Saved secrets are never displayed')
        await submit()
        expect(save).toHaveBeenCalledTimes(1)
        expect(save.mock.calls[0]?.[0]).toEqual({
            id: channel.id,
            name: 'My webhook',
            kind: 'webhook',
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'warning',
            thresholdSeconds: 10,
            recovery: true,
        })
    })
    test('requires an explicit complete replacement and hides private network inputs for regular users', async () => {
        const { save } = await render()
        const replace = [...document.querySelectorAll('label')].find((item) =>
            item.textContent?.includes('Replace destination'),
        )!
        await click(replace)
        expect(document.querySelector('input[type="password"]')).not.toBeNull()
        expect(document.body.textContent).not.toContain('Allowed private networks')
        await submit()
        expect(save).not.toHaveBeenCalled()
    })
    test('validates duration bounds before submitting the channel', async () => {
        const { save } = await render({
            editor: {
                channel: { ...channel, thresholdSeconds: 86_401 },
                revision: 5,
                channels: [channel],
            },
        })
        await submit()
        expect(save).not.toHaveBeenCalled()
    })
    test('live settings changes preserve the open editor snapshot and unsaved values', async () => {
        const { props, rerender, save } = await render()
        await rerender({
            ...props,
            settings: {
                ...settings,
                configuration: {
                    ...settings.configuration,
                    revision: 9,
                    channels: [{ ...channel, name: 'Changed elsewhere' }],
                },
            },
        })
        expect(
            [...document.querySelectorAll('input')].some((input) => input.value === 'My webhook'),
        ).toBe(true)
        await submit()
        expect(save.mock.calls[0]?.[1].revision).toBe(5)
    })
})
