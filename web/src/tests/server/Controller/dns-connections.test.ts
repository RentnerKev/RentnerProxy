// oxlint-disable no-await-in-loop -- Verify each rejected contract fixture independently in sequence.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createDnsConnectionsController } from '@/server/Controller/dns-connections.server.ts'
import { dnsConnectionMetadataSchema } from '@/server/Controller/dns-connections.validation.ts'
import { controllerRequest } from '@/server/Controller/transport.server.ts'
import { readFile } from 'node:fs/promises'

const originalUrl = process.env.RENTNERPROXY_CONTROLLER_URL
const originalToken = process.env.RENTNERPROXY_CONTROLLER_TOKEN
let fetchSpy: { mockRestore(): void } | undefined
afterEach(() => {
    fetchSpy?.mockRestore()
    fetchSpy = undefined
    if (originalUrl === undefined) delete process.env.RENTNERPROXY_CONTROLLER_URL
    else process.env.RENTNERPROXY_CONTROLLER_URL = originalUrl
    if (originalToken === undefined) delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
    else process.env.RENTNERPROXY_CONTROLLER_TOKEN = originalToken
})

const id = '0198d98a-0000-7000-8000-000000000001'
const zoneId = 'a'.repeat(32)
const actorUserId = '0198d98a-0000-7000-8000-000000000002'
const zone = { id: zoneId, name: 'example.com' }
function metadata() {
    return {
        id,
        provider: 'cloudflare' as const,
        ownership: 'instance' as const,
        name: 'Test',
        createdByUserId: actorUserId,
        revision: 1,
        zones: [zone],
        references: [],
        createdAt: '2026-10-15T12:00:00Z',
        updatedAt: '2026-10-15T12:00:00Z',
    }
}
describe('DNS connection controller boundary', () => {
    test('reads the bounded authoritative provider catalogue without altering connection metadata', async () => {
        const expected: unknown = JSON.parse(
            await readFile(
                new URL(
                    '../../../../../core/tests/fixtures/dns-provider-catalog.json',
                    import.meta.url,
                ),
                'utf8',
            ),
        )
        const controller = createDnsConnectionsController(async (path, options) => {
            expect(path).toBe('/internal/v1/dns/providers')
            expect(options).toMatchObject({
                privileged: true,
                confidential: true,
                responseLimit: 16_384,
            })
            return expected
        })
        expect(await controller.providers()).toEqual([
            {
                id: 'cloudflare',
                capabilities: {
                    zoneDiscovery: true,
                    txtCreate: true,
                    txtCleanup: true,
                    addressRecordTypes: ['A', 'AAAA'],
                    proxyOptions: 'cloudflare',
                },
            },
        ])
    })
    test('rejects unknown provider descriptors and sanitizes catalogue failures', async () => {
        const controller = createDnsConnectionsController(async () => ({
            providers: [{ id: 'external-plugin', capabilities: {} }],
        }))
        await expect(controller.providers()).rejects.toThrow('controller_unavailable')
    })
    test('requires bearer authentication even on loopback before fetching', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18081'
        delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
        const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
            Response.json({ connections: [] }),
        )
        fetchSpy = fetchMock
        expect(
            await controllerRequest('/internal/v1/dns/connections', { timeoutMs: 1_000 }),
        ).toBeNull()
        expect(
            await controllerRequest('/internal/v1/dns/providers', { timeoutMs: 1_000 }),
        ).toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
        await controllerRequest('/internal/v1/dns/connections', { timeoutMs: 1_000 })
        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:18081/internal/v1/dns/connections',
            expect.objectContaining({
                headers: expect.objectContaining({ authorization: `Bearer ${'a'.repeat(64)}` }),
            }),
        )
    })
    test('sends confidential bounded authenticated requests with actor and revision', async () => {
        const controller = createDnsConnectionsController(async (path, options) => {
            expect(path).toBe(`/internal/v1/dns/connections/${id}`)
            expect(options).toMatchObject({
                method: 'PUT',
                privileged: true,
                confidential: true,
                timeoutMs: 25_000,
                responseLimit: 1_048_576,
            })
            expect(JSON.parse(options.body!)).toEqual({
                name: 'Test',
                expectedRevision: 0,
                apiToken: 'test-token',
                zoneIds: [zoneId],
                actorUserId,
            })
            return metadata()
        })
        expect(
            (
                await controller.save(id, {
                    name: 'Test',
                    expectedRevision: 0,
                    apiToken: 'test-token',
                    zoneIds: [zoneId],
                    actorUserId,
                })
            ).id,
        ).toBe(id)
    })
    test('rejects secrets, duplicate metadata and malformed references', async () => {
        for (const payload of [
            { connections: [{ ...metadata(), apiToken: 'must-not-escape' }] },
            { connections: [metadata(), metadata()] },
            {
                connections: [
                    {
                        ...metadata(),
                        references: [{ zoneId: 'b'.repeat(32), consumer: { type: 'ddns', id } }],
                    },
                ],
            },
        ]) {
            const controller = createDnsConnectionsController(async () => payload)
            await expect(controller.list()).rejects.toThrow(
                'admin.dnsConnections.errors.controller_unavailable',
            )
        }
        expect(
            dnsConnectionMetadataSchema.safeParse({ ...metadata(), zones: [zone, zone] }).success,
        ).toBe(false)
    })
    test('only allowlisted strict errors reach the caller', async () => {
        await expect(
            createDnsConnectionsController(async () => ({ error: 'provider_unauthorized' })).list(),
        ).rejects.toThrow('admin.dnsConnections.errors.provider_unauthorized')
        for (const payload of [
            { error: 'raw provider token secret' },
            { error: 'provider_unauthorized', detail: 'secret' },
            null,
        ]) {
            await expect(
                createDnsConnectionsController(async () => payload).list(),
            ).rejects.toThrow('admin.dnsConnections.errors.controller_unavailable')
        }
    })
    test('permission checks require matching metadata and complete verified zone coverage', async () => {
        const verification = {
            status: 'connected' as const,
            checkedAt: '2026-10-15T12:01:00Z',
            zoneIds: [zoneId],
            error: null,
        }
        const checked = { ...metadata(), verification }
        const controller = createDnsConnectionsController(async (path, options) => {
            expect(path).toBe(`/internal/v1/dns/connections/${id}/verify`)
            expect(options).toMatchObject({
                method: 'POST',
                timeoutMs: 65_000,
                confidential: true,
                privileged: true,
            })
            expect(JSON.parse(options.body!)).toEqual({ expectedRevision: 1 })
            return checked
        })
        expect(await controller.verify(id, 1)).toEqual(checked)
        for (const payload of [
            { ...checked, id: actorUserId },
            { ...checked, revision: 2 },
            { ...checked, verification: { ...verification, zoneIds: [] } },
            { ...checked, verification: { ...verification, error: 'provider_unauthorized' } },
            { ...checked, verification: { ...verification, status: 'failed' } },
            { ...checked, verification: { ...verification, checkedAt: null } },
        ])
            await expect(
                createDnsConnectionsController(async () => payload).verify(id, 1),
            ).rejects.toThrow('controller_unavailable')
    })
    test('rejects substituted identity, revision, selected zones and false write claims', async () => {
        for (const payload of [
            { ...metadata(), id: actorUserId },
            { ...metadata(), revision: 2 },
            { ...metadata(), zones: [{ ...zone, id: 'b'.repeat(32) }] },
        ]) {
            await expect(
                createDnsConnectionsController(async () => payload).save(id, {
                    name: 'Test',
                    expectedRevision: 0,
                    zoneIds: [zoneId],
                    actorUserId,
                }),
            ).rejects.toThrow('controller_unavailable')
        }
        for (const payload of [
            {
                zones: [zone],
                selectedZoneIds: [zoneId],
                checkedAt: '2026-10-15T12:00:00Z',
                dnsWriteVerified: true,
            },
            {
                zones: [zone],
                selectedZoneIds: [],
                checkedAt: '2026-10-15T12:00:00Z',
                dnsWriteVerified: false,
            },
        ])
            await expect(
                createDnsConnectionsController(async () => payload).test({
                    apiToken: 'test-token',
                    zoneIds: [zoneId],
                }),
            ).rejects.toThrow('controller_unavailable')
    })
    test('validates reference echo and delete confirmation', async () => {
        const reference = {
            connectionId: id,
            zoneId,
            consumer: { type: 'ddns' as const, id: actorUserId },
        }
        await expect(
            createDnsConnectionsController(async () => ({
                reference: { ...reference, connectionId: actorUserId },
                revision: 1,
                zone,
            })).validateReference(reference),
        ).rejects.toThrow('controller_unavailable')
        await expect(
            createDnsConnectionsController(async () => ({
                deleted: true,
                apiToken: 'secret',
            })).delete(id, 1),
        ).rejects.toThrow('controller_unavailable')
    })
})
