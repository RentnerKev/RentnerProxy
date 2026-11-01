// oxlint-disable no-await-in-loop -- Assert ordered independent authorization and audit failure cases.
import { expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createBackupDownloadService } from '@/server/Admin/Backups/backups-download.service.ts'
import { createBackupDownloadHttpHandler } from '@/server/Admin/Backups/backups-download-response.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

const id = '00000000-0000-4000-8000-000000000001'
const origin = 'https://proxy.example.test'
const request = (headers: HeadersInit = {}, suffix = '') =>
    new Request(origin + '/api/admin/backups/' + id + '/download' + suffix, {
        headers: { 'sec-fetch-site': 'same-origin', ...headers },
    })

test('download requires same origin, canonical id and no query before reaching secrets service', async () => {
    let calls = 0
    const handle = createBackupDownloadHttpHandler({
        origin: () => origin,
        download: async () => {
            calls++
            return new Response('fixture')
        },
    })
    for (const [input, jobId, status] of [
        [request({ origin: 'https://other.example.test' }), id, 403],
        [request({ 'sec-fetch-site': 'cross-site' }), id, 403],
        [request({ 'sec-fetch-site': 'none' }), id, 403],
        [request(), '../private', 404],
        [request(), '0198D98A-0000-7000-8000-000000000001', 404],
        [request({}, '?path=/private'), id, 404],
    ] as const) {
        expect((await handle(input, jobId)).status).toBe(status)
    }
    expect(calls).toBe(0)
    const response = await handle(request(), id)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="rentnerproxy-backup-${id}.tar"`,
    )
    expect(await response.text()).toBe('fixture')
    const proxied = await handle(
        new Request('http://127.0.0.1:3000/api/admin/backups/' + id + '/download', {
            headers: { origin },
        }),
        id,
    )
    expect(proxied.status).toBe(200)
    await proxied.body?.cancel()
})

test('safe browser failure returns to backups while API failures stay JSON', async () => {
    const handle = createBackupDownloadHttpHandler({
        origin: () => origin,
        download: async () => new Response('/private/internal-detail', { status: 409 }),
    })
    const browser = await handle(request({ 'sec-fetch-mode': 'navigate', accept: 'text/html' }), id)
    expect(browser.status).toBe(303)
    expect(browser.headers.get('location')).toBe('/backups?downloadError=conflict')
    expect(await browser.text()).toBe('')
    const api = await handle(request(), id)
    expect(api.status).toBe(409)
    expect(await api.json()).toEqual({ error: 'conflict' })
})

test('view permission alone cannot reach controller download', async () => {
    let calls = 0
    const service = createBackupDownloadService({
        authorize: async () => {
            throw new AuthDomainError('permission_denied', 'Denied')
        },
        limit: async () => {},
        download: async () => {
            calls++
            return new Response('secrets')
        },
        transaction: async () => {
            throw new Error('must not run')
        },
    })
    const handle = createBackupDownloadHttpHandler({ origin: () => origin, download: service })
    const response = await handle(request(), id)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'permission_denied' })
    expect(calls).toBe(0)
})

test('reauthorization and audit commit happen before exposing the download body', async () => {
    const calls: string[] = []
    const service = createBackupDownloadService({
        authorize: async () => {
            calls.push('authorize')
            return { id }
        },
        limit: async () => {
            calls.push('limit')
        },
        download: async () => {
            calls.push('prepare')
            return new Response('snapshot')
        },
        transaction: async (run) => {
            const result = await run({
                authorize: async (actor, permission) => {
                    expect(actor).toBe(id)
                    expect(permission).toBe(PERMISSIONS.BACKUPS_MANAGE)
                    calls.push('reauthorize')
                },
                audit: async (event) => {
                    expect(event).toMatchObject({
                        action: 'request',
                        resource: 'config-export',
                        targetId: id,
                    })
                    calls.push('audit')
                },
            })
            calls.push('commit')
            return result
        },
    })
    const response = await service(id, new AbortController().signal)
    expect(calls).toEqual(['authorize', 'limit', 'prepare', 'reauthorize', 'audit', 'commit'])
    expect(await response.text()).toBe('snapshot')
})

test('failed audit or revoked manage permission cancels prepared secret stream', async () => {
    for (const failure of ['permission', 'audit', 'commit']) {
        let cancelled = false
        const service = createBackupDownloadService({
            authorize: async () => ({ id }),
            limit: async () => {},
            download: async () =>
                new Response(
                    new ReadableStream({
                        cancel() {
                            cancelled = true
                        },
                    }),
                ),
            transaction: async (run) => {
                await run({
                    authorize: async () => {
                        if (failure === 'permission') throw new Error('revoked')
                    },
                    audit: async () => {
                        if (failure === 'audit') throw new Error('audit failure')
                    },
                })
                throw new Error('commit failure')
            },
        })
        await expect(service(id, new AbortController().signal)).rejects.toThrow()
        expect(cancelled).toBe(true)
    }
})
