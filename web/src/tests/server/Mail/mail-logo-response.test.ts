import { describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { decode } from 'fast-png'
import {
    MAIL_LOGO_CACHE_SIZE,
    MAIL_LOGO_RENDER_RATE_LIMITS,
    MAIL_LOGO_VERSION,
} from '@/config/mail.config.ts'
import { getMailLogoPng } from '@/server/Mail/mail-logo.ts'
import { getMailLogoResponseService } from '@/server/Mail/mail-logo.service.ts'
import { createRateLimitKey } from '@/server/Valkey/rate-limiter.service.ts'
import type { RateLimitDependencies } from '@/server/Valkey/Types/rate-limiter.types.ts'
import type { ValkeyCommandClient } from '@/server/Valkey/Types/valkey.types.ts'

const url = 'https://proxy.example.test/media/mail-logo/8844ee?v=1'
const admitted: RateLimitDependencies = {
    getClient: () => ({ ping: async () => 'PONG', send: async () => [1, 60_000] }),
}

describe('public mail logo response', () => {
    test.each(['30ee61', '8844ee', '8844EE'])(
        'serves %s without authentication and with public image caching',
        async (accent) => {
            const response = await getMailLogoResponseService(new Request(url), accent, admitted)
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('image/png')
            expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            expect(response.headers.has('set-cookie')).toBe(false)
            expect(response.headers.has('vary')).toBe(false)
            const content = Buffer.from(await response.arrayBuffer())
            expect(content).toEqual(Buffer.from(await getMailLogoPng(`#${accent}`)))
            expect(response.headers.get('etag')).toBe(
                `"${createHash('sha256').update(`${accent.toLowerCase()}:${MAIL_LOGO_VERSION}`).digest('hex')}"`,
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
        const getClient = mock(() => {
            throw new Error('Invalid inputs must not access Valkey')
        })
        const response = await getMailLogoResponseService(new Request(url), accent, { getClient })
        expect(response.status).toBe(404)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(response.headers.has('etag')).toBe(false)
        expect(await response.text()).toBe('')
        expect(getClient).not.toHaveBeenCalled()
    })

    test('supports strong, weak, list and wildcard conditional GET without a body', async () => {
        const first = await getMailLogoResponseService(new Request(url), '8844ee', admitted)
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
            admitted,
        )
        expect(changed.status).toBe(200)
        expect(changed.headers.get('etag')).not.toBe(etag)
        expect((await changed.arrayBuffer()).byteLength).toBeGreaterThan(0)
    })

    test('charges only new renders and serves cached images and validators during a Valkey outage', async () => {
        const send = mock(async () => [1, 60_000])
        const response = await getMailLogoResponseService(new Request(url), 'a10001', {
            getClient: () => ({ ping: async () => 'PONG', send }),
        })
        expect(response.status).toBe(200)
        expect(send).toHaveBeenCalledTimes(2)
        const etag = response.headers.get('etag')!
        const getClient = mock(() => {
            throw new Error('Valkey is unavailable')
        })
        const [cached, unchanged] = await Promise.all([
            getMailLogoResponseService(new Request(url), 'A10001', { getClient }),
            getMailLogoResponseService(
                new Request(url, { headers: { 'If-None-Match': etag } }),
                'a10001',
                { getClient },
            ),
        ])
        expect(cached.status).toBe(200)
        expect(cached.headers.get('etag')).toBe(etag)
        expect(unchanged.status).toBe(304)
        expect(await unchanged.text()).toBe('')
        expect(getClient).not.toHaveBeenCalled()
    })

    test('bounds distinct public renders without letting forged forwarding headers bypass admission', async () => {
        const counts = new Map<string, number>()
        const client: ValkeyCommandClient = {
            ping: async () => 'PONG',
            send: async (command, args) => {
                expect(command).toBe('EVAL')
                expect(args[3]).toBe('60000')
                const key = args[2]!
                const count = (counts.get(key) ?? 0) + 1
                counts.set(key, count)
                return [count, 9_001]
            },
        }
        const responses = await Promise.all(
            Array.from({ length: 20 }, (_, index) =>
                getMailLogoResponseService(
                    new Request(url, {
                        headers: {
                            'X-Forwarded-For': `192.0.2.${index + 1}`,
                            Forwarded: `for=192.0.2.${index + 1}`,
                        },
                    }),
                    `c${index.toString(16).padStart(5, '0')}`,
                    { getClient: () => client },
                ),
            ),
        )
        expect(responses.filter((response) => response.status === 200)).toHaveLength(
            MAIL_LOGO_RENDER_RATE_LIMITS.client.limit,
        )
        const rejected = responses.filter((response) => response.status === 429)
        expect(rejected).toHaveLength(20 - MAIL_LOGO_RENDER_RATE_LIMITS.client.limit)
        await Promise.all(
            rejected.map(async (response) => {
                expect(response.headers.get('cache-control')).toBe('no-store')
                expect(response.headers.get('retry-after')).toBe('10')
                expect(response.headers.has('etag')).toBe(false)
                expect(await response.text()).toBe('')
            }),
        )
        expect([...counts.keys()]).toEqual([
            createRateLimitKey(MAIL_LOGO_RENDER_RATE_LIMITS.client.scope, 'unknown'),
            createRateLimitKey(MAIL_LOGO_RENDER_RATE_LIMITS.global.scope, 'all'),
        ])
        expect(
            counts.get(createRateLimitKey(MAIL_LOGO_RENDER_RATE_LIMITS.global.scope, 'all')),
        ).toBe(MAIL_LOGO_RENDER_RATE_LIMITS.client.limit)
    })

    test('also enforces the shared installation budget before rendering', async () => {
        const send = mock(async (_command: string, args: string[]) => [
            args[2] === createRateLimitKey(MAIL_LOGO_RENDER_RATE_LIMITS.global.scope, 'all')
                ? MAIL_LOGO_RENDER_RATE_LIMITS.global.limit + 1
                : 1,
            1,
        ])
        const response = await getMailLogoResponseService(new Request(url), 'a10002', {
            getClient: () => ({ ping: async () => 'PONG', send }),
        })
        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('1')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(send).toHaveBeenCalledTimes(2)
        expect(await response.text()).toBe('')
    })

    test('fails closed on unavailable admission without caching a failure', async () => {
        const unavailable = await getMailLogoResponseService(new Request(url), 'a10003', {
            getClient: () => null,
        })
        expect(unavailable.status).toBe(503)
        expect(unavailable.headers.get('cache-control')).toBe('no-store')
        expect(unavailable.headers.get('retry-after')).toBe('60')
        expect(unavailable.headers.has('etag')).toBe(false)
        expect(await unavailable.text()).toBe('')
        const retried = await getMailLogoResponseService(new Request(url), 'a10003', admitted)
        expect(retried.status).toBe(200)
    })

    test('revalidates an evicted image without rendering or consuming unavailable admission', async () => {
        const first = await getMailLogoResponseService(new Request(url), 'a10004', admitted)
        expect(first.status).toBe(200)
        const etag = first.headers.get('etag')!
        await Promise.all(
            Array.from({ length: MAIL_LOGO_CACHE_SIZE }, (_, index) =>
                getMailLogoPng(`#e${index.toString(16).padStart(5, '0')}`),
            ),
        )
        const getClient = mock(() => {
            throw new Error('Admission is unavailable')
        })
        await Promise.all(
            [etag, `W/${etag}`, `"other", W/${etag}`, '*'].map(async (validator) => {
                const response = await getMailLogoResponseService(
                    new Request(url, { headers: { 'If-None-Match': validator } }),
                    'A10004',
                    { getClient },
                )
                expect(response.status).toBe(304)
                expect(response.headers.get('etag')).toBe(etag)
                expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
                expect(await response.text()).toBe('')
            }),
        )
        expect(getClient).not.toHaveBeenCalled()
        const miss = await getMailLogoResponseService(
            new Request(url, { headers: { 'If-None-Match': '"outdated"' } }),
            'a10004',
            { getClient },
        )
        expect(miss.status).toBe(503)
        expect(getClient).toHaveBeenCalledTimes(1)
    })
})
