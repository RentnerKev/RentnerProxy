import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { decode } from 'fast-png'
import { getMailLogoPng } from '@/server/Mail/mail-logo.ts'
import { getMailLogoResponseService } from '@/server/Mail/mail-logo.service.ts'

const url = 'https://proxy.example.test/media/mail-logo/8844ee?v=1'

describe('public mail logo response', () => {
    test.each(['30ee61', '8844ee', '8844EE'])(
        'serves %s without authentication and with public image caching',
        async (accent) => {
            const response = await getMailLogoResponseService(new Request(url), accent)
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('image/png')
            expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            expect(response.headers.has('set-cookie')).toBe(false)
            expect(response.headers.has('vary')).toBe(false)
            const content = Buffer.from(await response.arrayBuffer())
            expect(content).toEqual(Buffer.from(await getMailLogoPng(`#${accent}`)))
            expect(response.headers.get('etag')).toBe(
                `"${createHash('sha256').update(content).digest('hex')}"`,
            )
            const image = decode(content)
            expect([image.width, image.height, image.channels]).toEqual([512, 192, 4])
        },
    )

    test.each([
        '',
        '#8844ee',
        '8844e',
        '8844eee',
        '8844gg',
        '8844ee\n',
        '../8844ee',
        '8844ee.png',
        'https://example.test/logo.png',
        '%238844ee',
    ])('rejects invalid color %j without cacheable content', async (accent) => {
        const response = await getMailLogoResponseService(new Request(url), accent)
        expect(response.status).toBe(404)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.has('etag')).toBe(false)
        expect(await response.text()).toBe('')
    })

    test('supports strong, weak, list and wildcard conditional GET without a body', async () => {
        const first = await getMailLogoResponseService(new Request(url), '8844ee')
        const etag = first.headers.get('etag')!
        await Promise.all(
            [etag, `W/${etag}`, `"unrelated", W/${etag}`, '*'].map(async (validator) => {
                const response = await getMailLogoResponseService(
                    new Request(url, { headers: { 'If-None-Match': validator } }),
                    '8844ee',
                )
                expect(response.status).toBe(304)
                expect(response.headers.get('etag')).toBe(etag)
                expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
                expect(await response.text()).toBe('')
            }),
        )
        const changed = await getMailLogoResponseService(
            new Request(url, { headers: { 'If-None-Match': etag } }),
            '30ee61',
        )
        expect(changed.status).toBe(200)
        expect(changed.headers.get('etag')).not.toBe(etag)
        expect((await changed.arrayBuffer()).byteLength).toBeGreaterThan(0)
    })
})
