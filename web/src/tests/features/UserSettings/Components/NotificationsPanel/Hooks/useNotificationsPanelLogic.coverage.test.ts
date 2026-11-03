import { expect, mock, test } from 'bun:test'
import { flushHook, mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type {
    Channel,
    ChannelInput,
} from '@/features/UserSettings/Components/NotificationsPanel/Types/notifications-panel.types.ts'

const user: AuthenticatedUser = {
    id: 'user',
    displayName: 'Fixture',
    email: 'fixture@example.com',
    profileImageVersion: null,
    roles: [],
    permissions: [],
    language: 'en',
    themeMode: 'dark',
}
const channel: Channel = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Alerts',
    kind: 'email',
    revision: 3,
    enabled: true,
    events: ['ddns'],
    minimumSeverity: 'warning',
    thresholdSeconds: 10,
    recovery: true,
    destinationConfigured: true,
    hasAuthorization: false,
}
const second: Channel = {
    ...channel,
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Secondary',
}
const settings = {
    configuration: {
        version: 1,
        revision: 7,
        enabled: true,
        pausedAfterRestore: false,
        channels: [channel, second],
    },
    allowedCategories: ['ddns'],
    canUsePrivateDestinations: false,
    canResumeDelivery: true,
    smtpConfigured: true,
}
let rejected = false
let offline = false
const update = mock(async (_input: unknown) => {
    if (offline) throw new Error('offline')
    return rejected
        ? { success: false, message: 'conflict', code: 'configuration_conflict' }
        : { success: true, value: settings }
})
const testChannel = mock(async (_input: unknown) => ({
    success: true,
    value: { success: true, code: 'ok' },
}))
const success = mock(() => {})
const error = mock(() => {})
mock.module('@/features/UserSettings/Notifications/middleware.ts', () => ({
    getPersonalNotificationSettingsHandler: mock(async () => settings),
    getPersonalNotificationStatusHandler: mock(async () => ({
        incidents: [],
        deliveries: [],
        pendingCount: 0,
        deferredCount: 0,
        saturationCount: 0,
    })),
    updatePersonalNotificationConfigurationHandler: update,
    testPersonalNotificationChannelHandler: testChannel,
}))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
const { default: useNotificationsPanelLogic } =
    await import('@/features/UserSettings/Components/NotificationsPanel/Hooks/useNotificationsPanelLogic.ts')

test('notification edits use revision snapshots and preserve unrelated channels, with explicit delete/resume and conflict retry', async () => {
    const hook = await mountHook(() => useNotificationsPanelLogic({ user, active: true }))
    try {
        await flushHook()
        expect(hook.value.state.settings?.configuration.revision).toBe(7)
        expect(hook.value.state.testBlocked).toBe(false)
        await hook.run(() => hook.value.handler.handleEdit(channel))
        const snapshot = hook.value.state.editor
        if (!snapshot) throw new Error('Editor did not open')
        const edited: ChannelInput = {
            id: channel.id,
            name: 'Renamed',
            kind: 'email',
            enabled: true,
            events: ['ddns'],
            minimumSeverity: 'error',
            thresholdSeconds: 20,
            recovery: true,
        }
        expect(await hook.run(() => hook.value.handler.handleSave(edited, snapshot))).toBe(true)
        expect(update).toHaveBeenCalledWith({
            data: {
                channels: [expect.objectContaining({ id: second.id }), edited],
                expectedRevision: 7,
            },
        })
        expect(hook.value.state.editor).toBeNull()
        await hook.run(() => hook.value.handler.handleToggle(channel))
        expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
            data: {
                channels: [
                    expect.objectContaining({ id: channel.id, enabled: false }),
                    expect.objectContaining({ id: second.id, enabled: true }),
                ],
            },
        })
        await hook.run(() => hook.value.handler.handleEdit(null))
        await hook.run(() => hook.value.handler.handleClose())
        expect(hook.value.state.editor).toBeNull()
        await hook.run(() => hook.value.handler.handleRequestDelete(channel))
        expect(hook.value.state.deleting?.id).toBe(channel.id)
        rejected = true
        await hook.run(() => hook.value.handler.handleConfirmDelete())
        expect(hook.value.state.deleting?.id).toBe(channel.id)
        expect(error).toHaveBeenCalledWith('account.notifications.conflict', {
            title: 'toast.titles.error',
        })
        offline = true
        await hook.run(() => hook.value.handler.handleResume())
        expect(error).toHaveBeenCalledWith('account.notifications.actionFailed', {
            title: 'toast.titles.error',
        })
        rejected = false
        offline = false
        await hook.run(() => hook.value.handler.handleConfirmDelete())
        expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
            data: { channels: [expect.objectContaining({ id: second.id })], expectedRevision: 7 },
        })
        expect(hook.value.state.deleting).toBeNull()
        await hook.run(() => hook.value.handler.handleResume())
        expect(update.mock.calls.at(-1)?.[0]).toMatchObject({
            data: { resumeDelivery: true, expectedRevision: 7 },
        })
        await hook.run(() => hook.value.handler.handleTest(channel))
        expect(testChannel).toHaveBeenCalledWith({
            data: { channelId: channel.id, expectedRevision: 3 },
        })
        expect(success).toHaveBeenCalledWith('account.notifications.testSent', {
            title: 'toast.titles.success',
        })
        testChannel.mockResolvedValueOnce({
            success: true,
            value: { success: false, code: 'timeout' },
        })
        await hook.run(() => hook.value.handler.handleTest(channel))
        expect(error).toHaveBeenCalledWith('account.notifications.errors.timeout', {
            title: 'toast.titles.error',
        })
        testChannel.mockRejectedValueOnce(new Error('offline'))
        await hook.run(() => hook.value.handler.handleTest(channel))
        expect(error).toHaveBeenCalledWith('account.notifications.actionFailed', {
            title: 'toast.titles.error',
        })
        await hook.run(() => hook.value.handler.handleRequestDelete(channel))
        await hook.run(() => hook.value.handler.handleDelete())
        expect(hook.value.state.deleting).toBeNull()
    } finally {
        rejected = false
        offline = false
        await hook.dispose()
    }
})
