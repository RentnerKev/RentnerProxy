import { describe, expect, mock, test } from 'bun:test'
import { MAIL_LOGO_MAX_PENDING } from '@/config/mail.config.ts'
import { getMailLogoPng, MailLogoBusyError } from '@/server/Mail/mail-logo.ts'

describe('mail logo rendering admission', () => {
    test('coalesces normalized colors before admission and returns independent buffers', async () => {
        const gate = Promise.withResolvers<void>()
        const admit = mock(() => gate.promise)
        const first = getMailLogoPng('#b10001', admit)
        const second = getMailLogoPng('#B10001', admit)
        await Promise.resolve()
        expect(admit).toHaveBeenCalledTimes(1)
        gate.resolve()
        const [one, two] = await Promise.all([first, second])
        expect(one).toEqual(two)
        expect(one).not.toBe(two)
    })

    test('retries a rejected admission instead of retaining a rejected promise', async () => {
        const denied = new Error('Admission denied')
        await expect(
            getMailLogoPng('#b10002', async () => {
                throw denied
            }),
        ).rejects.toBe(denied)
        const admit = mock(async () => {})
        const content = await getMailLogoPng('#b10002', admit)
        expect(admit).toHaveBeenCalledTimes(1)
        expect(content.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    })

    test('bounds pending admissions without letting rejected colors evict successfully cached images', async () => {
        const ready = await getMailLogoPng('#b10003')
        const gate = Promise.withResolvers<void>()
        const waiting = Array.from({ length: MAIL_LOGO_MAX_PENDING }, (_, index) =>
            getMailLogoPng(`#d${index.toString(16).padStart(5, '0')}`, () => gate.promise),
        )
        const settled = Promise.allSettled(waiting)
        try {
            await expect(getMailLogoPng('#b10004', () => gate.promise)).rejects.toBeInstanceOf(
                MailLogoBusyError,
            )
            const admit = mock(async () => {
                throw new Error('A cache hit needs no admission')
            })
            expect(await getMailLogoPng('#b10003', admit)).toEqual(ready)
            expect(admit).not.toHaveBeenCalled()
        } finally {
            gate.reject(new Error('Denied fixture admissions'))
            const results = await settled
            expect(results.every((result) => result.status === 'rejected')).toBe(true)
        }
        expect(await getMailLogoPng('#b10003')).toEqual(ready)
    })
})
