// oxlint-disable no-await-in-loop -- Reject each malformed controller response separately.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createDdnsController } from '@/server/Controller/ddns.server.ts'
import { controllerRequest } from '@/server/Controller/transport.server.ts'
import {
    DDNS_ACTOR,
    ddnsBatch,
    ddnsSettings,
    ddnsSnapshot,
    ddnsTarget,
} from '@/tests/Helpers/ddnsFixture.ts'

const originalUrl = process.env.RENTNERPROXY_CONTROLLER_URL
const originalToken = process.env.RENTNERPROXY_CONTROLLER_TOKEN
afterEach(() => {
    if (originalUrl === undefined) delete process.env.RENTNERPROXY_CONTROLLER_URL
    else process.env.RENTNERPROXY_CONTROLLER_URL = originalUrl
    if (originalToken === undefined) delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
    else process.env.RENTNERPROXY_CONTROLLER_TOKEN = originalToken
})
const draft = ddnsSettings([ddnsTarget({ selection: { mode: 'create' } })])
describe('DDNS controller boundary', () => {
    test('requires bearer credentials on loopback even without privileged hint', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
        delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
        const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(ddnsSnapshot()))
        try {
            expect(
                await controllerRequest('/internal/v1/ddns/status', { timeoutMs: 1000 }),
            ).toBeNull()
            expect(fetch).not.toHaveBeenCalled()
            process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
            await createDdnsController().status()
            expect(fetch).toHaveBeenCalledWith(
                'http://127.0.0.1:18081/internal/v1/ddns/status',
                expect.objectContaining({
                    redirect: 'error',
                    headers: expect.objectContaining({ authorization: `Bearer ${'a'.repeat(64)}` }),
                }),
            )
        } finally {
            fetch.mockRestore()
        }
    })
    test('uses exact private paths, actor, revision and bounded confidential requests', async () => {
        const client = createDdnsController(async (path, options) => {
            expect(path).toBe('/internal/v1/ddns/config')
            expect(options).toMatchObject({
                method: 'PUT',
                privileged: true,
                confidential: true,
                timeoutMs: 30000,
                responseLimit: 1048576,
            })
            expect(JSON.parse(options.body!)).toEqual({
                actorUserId: DDNS_ACTOR,
                expectedRevision: 2,
                configuration: { ...draft, enabled: false },
            })
            return ddnsSnapshot(draft, false, 3)
        })
        expect(
            (
                await client.save({
                    actorUserId: DDNS_ACTOR,
                    expectedRevision: 2,
                    configuration: { ...draft, enabled: false },
                })
            ).configuration?.revision,
        ).toBe(3)
    })
    test('rejects unknown fields, unmatched results, wrong revision and enabled save mismatch', async () => {
        for (const payload of [
            null,
            { ...ddnsSnapshot(), token: 'never-return' },
            { ...ddnsSnapshot(draft), targets: [] },
        ])
            await expect(createDdnsController(async () => payload).status()).rejects.toMatchObject({
                code: 'controller_unavailable',
            })
        for (const payload of [
            ddnsBatch({ ...draft, targets: [] }),
            { ...ddnsBatch(draft), preview: false },
            {
                ...ddnsBatch(draft),
                targets: [...ddnsBatch(draft).targets, ...ddnsBatch(draft).targets],
            },
        ])
            await expect(
                createDdnsController(async () => payload).preview({
                    ...draft,
                    actorUserId: DDNS_ACTOR,
                }),
            ).rejects.toMatchObject({ code: 'controller_unavailable' })
        await expect(
            createDdnsController(async () => ddnsSnapshot(draft, true, 2)).save({
                actorUserId: DDNS_ACTOR,
                expectedRevision: 1,
                configuration: { ...draft, enabled: false },
            }),
        ).rejects.toMatchObject({ code: 'controller_unavailable' })
        await expect(
            createDdnsController(async () => ddnsSnapshot(draft, true, 7)).enable({
                actorUserId: DDNS_ACTOR,
                expectedRevision: 1,
            }),
        ).rejects.toMatchObject({ code: 'controller_unavailable' })
    })
    test('preserves safe retry information and redacts unexpected error payloads', async () => {
        await expect(
            createDdnsController(async () => ({
                error: 'retry_deferred',
                retryAfterSeconds: 45,
            })).sync({ actorUserId: DDNS_ACTOR, expectedRevision: 1 }),
        ).rejects.toMatchObject({ code: 'retry_deferred', retryAfterSeconds: 45 })
        await expect(
            createDdnsController(async () => ({ error: 'provider-token-never-return' })).status(),
        ).rejects.toMatchObject({ code: 'controller_unavailable' })
    })
})
