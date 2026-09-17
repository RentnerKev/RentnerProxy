import { afterEach, describe, expect, test } from 'bun:test'

import { createToastStore } from '../shared/Toast/Helpers/createToastStore'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('toast store', () => {
    const stores: Array<ReturnType<typeof createToastStore>> = []

    afterEach(() => {
        for (const store of stores) store.notify.clear()
        stores.length = 0
    })

    test('keeps only the three newest visible notifications', () => {
        const store = createToastStore()
        stores.push(store)

        store.notify.success('first')
        store.notify.info('second')
        store.notify.warning('third')
        store.notify.error('fourth')

        expect(store.getSnapshot()).toHaveLength(3)
        expect(store.getSnapshot().map((toast) => toast.message)).toEqual([
            'second',
            'third',
            'fourth',
        ])
    })

    test('replaces a repeated notification so its duration starts again', () => {
        const store = createToastStore()
        stores.push(store)

        const firstId = store.notify.error('same message', { duration: 100 })
        const secondId = store.notify.error('same message', { duration: 100 })

        expect(secondId).not.toBe(firstId)
        expect(store.getSnapshot()).toEqual([
            expect.objectContaining({
                id: secondId,
                duration: 100,
                message: 'same message',
                tone: 'error',
                open: true,
            }),
        ])
    })

    test('keeps independent task notifications outside the three-message notification limit', () => {
        const store = createToastStore()
        stores.push(store)

        store.notify.upsert('certificate-job-1', 'Queued', 'info', {
            title: 'Certificate request',
            context: 'app.example.com',
            persistent: true,
            dismissible: false,
            activity: 'running',
        })
        store.notify.success('first')
        store.notify.info('second')
        store.notify.warning('third')
        store.notify.error('fourth')

        expect(store.getSnapshot()).toHaveLength(4)
        expect(store.getSnapshot().filter((toast) => toast.kind === 'notification')).toHaveLength(3)
        expect(store.getSnapshot()[0]).toMatchObject({
            id: 'certificate-job-1',
            revision: 1,
            kind: 'task',
            message: 'Queued',
            context: 'app.example.com',
            persistent: true,
            dismissible: false,
            activity: 'running',
        })

        store.notify.upsert('certificate-job-1', 'Certificate assigned successfully.', 'success', {
            title: 'Certificate request',
            duration: 5_000,
        })

        expect(store.getSnapshot().filter((toast) => toast.kind === 'task')).toEqual([
            expect.objectContaining({
                id: 'certificate-job-1',
                revision: 2,
                message: 'Certificate assigned successfully.',
                tone: 'success',
                duration: 5_000,
            }),
        ])
    })

    test('isolates stores and removes dismissed notifications after their exit window', async () => {
        const first = createToastStore()
        const second = createToastStore()
        stores.push(first, second)

        const id = first.notify.success('first store')
        second.notify.success('second store')
        first.notify.dismiss(id)

        expect(first.getSnapshot()[0]?.open).toBe(false)
        expect(second.getSnapshot().map((toast) => toast.message)).toEqual(['second store'])

        await wait(250)
        expect(first.getSnapshot()).toEqual([])
        expect(second.getSnapshot()).toHaveLength(1)
    })

    test('reports a manual dismissal exactly once', () => {
        const store = createToastStore()
        stores.push(store)
        let dismissals = 0
        store.notify.upsert('certificate-job-1', 'Failed', 'error', {
            persistent: true,
            onDismiss: () => {
                dismissals += 1
            },
        })

        store.notify.dismiss('certificate-job-1')
        store.notify.dismiss('certificate-job-1')

        expect(dismissals).toBe(1)
    })
})
