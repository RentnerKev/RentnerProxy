import { expect, mock, test } from 'bun:test'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'
import type { NotificationStatus } from '@/lib/Notifications/Types/notifications.types.ts'
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ locale: 'en', t: (key: string) => key }),
}))
const { default: useDeliveryTableLogic } =
    await import('@/features/UserSettings/Components/NotificationsPanel/Hooks/useDeliveryTableLogic.ts')

test('notification delivery table filters translated states and sorts by timestamp while retaining deleted channel context', async () => {
    const delivery = {
        id: 'first',
        incidentId: 'missing',
        channelId: 'removed',
        channelRevision: 1,
        type: 'incident',
        category: 'ddns',
        resourceId: 'host-one',
        status: 'failed',
        attempts: 1,
        updatedAt: 20,
        error: 'timeout',
    } as const
    const status: NotificationStatus = {
        incidents: [],
        deliveries: [
            delivery,
            {
                ...delivery,
                id: 'second',
                type: 'recovery',
                resourceId: 'host-two',
                status: 'succeeded',
                updatedAt: 40,
                error: null,
            },
        ],
        pendingCount: 0,
        deferredCount: 0,
        saturationCount: 0,
    }
    const hook = await mountHook(() => useDeliveryTableLogic({ status, channels: [] }))
    try {
        expect(hook.value.table.getRowModel().rows.map((row) => row.id)).toEqual([
            'second',
            'first',
        ])
        const row = hook.value.table.getRowModel().rows[1]!
        expect(row.getValue('channelName')).toContain('account.notifications.deletedChannel')
        expect(row.getValue('incidentState')).toBe('account.notifications.incidentStates.unknown')
        expect(row.getValue('status')).toContain('account.notifications.errors.timeout')
        await hook.run(() => hook.value.table.setSorting([{ id: 'updatedAt', desc: false }]))
        expect(hook.value.table.getRowModel().rows[0]?.id).toBe('first')
        await hook.run(() => hook.value.table.getColumn('status')?.setFilterValue('succeeded'))
        expect(hook.value.table.getRowModel().rows.map((entry) => entry.id)).toEqual(['second'])
        await hook.run(() => hook.value.handler.handleToggleFilters())
        expect(hook.value.state.showColumnFilters).toBe(true)
        await hook.run(() => hook.value.handler.handleResetFilters())
        expect(hook.value.table.getRowModel().rows).toHaveLength(2)
    } finally {
        await hook.dispose()
    }
})
