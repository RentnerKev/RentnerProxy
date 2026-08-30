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
})
