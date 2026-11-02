import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { createProxyHostUpstreamHealthReader } from '@/server/Admin/ProxyHostManagement/upstream-health.service.ts'
import { getProxyHostUpstreamHealth } from '@/server/Controller/proxy.server.ts'
import type { ProxyHostUpstreamHealth } from '@/lib/ProxyRuntime/Types/upstream-health.types.ts'
import type { UpstreamHealthDesiredState } from '@/server/Admin/ProxyHostManagement/Types/upstream-health.types.ts'
const id = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const revision = 'sha256:' + 'a'.repeat(64)
const now = Date.parse('2026-11-02T12:00:00Z')
const desired: UpstreamHealthDesiredState = {
    hostId: id,
    enabled: true,
    hasPool: true,
    revision,
    members: [
        { host: 'primary.internal', port: 8080 },
        { host: 'secondary.internal', port: 8081 },
    ],
}
function healthy(overrides: Partial<ProxyHostUpstreamHealth> = {}): ProxyHostUpstreamHealth {
    return {
        hostId: id,
        revision,
        observedAt: new Date(now).toISOString(),
        state: 'available',
        members: desired.members.map((member, index) => ({ index, ...member, state: 'available' })),
        ...overrides,
    }
}
function fixture() {
    const authorize = mock(async () => 'viewer')
    const readDesired = mock(async () => desired)
    const readHealth = mock(async (): Promise<ProxyHostUpstreamHealth | null> => healthy())
    return {
        authorize,
        readDesired,
        readHealth,
        read: createProxyHostUpstreamHealthReader({
            authorize,
            readDesired,
            readHealth,
            now: () => now,
        }),
    }
}

describe('permission protected upstream health', () => {
    test('accepts current available and all-unavailable observations without edit permission', async () => {
        const f = fixture()
        expect(await f.read(id)).toEqual(healthy())
        expect(f.readDesired).toHaveBeenCalledWith(id, 'viewer')
        const unavailable = healthy({
            state: 'all_unavailable',
            members: healthy().members.map((member) =>
                Object.assign({}, member, { state: 'unavailable' as const }),
            ),
        })
        f.readHealth.mockResolvedValue(unavailable)
        expect(await f.read(id)).toEqual(unavailable)
    })
    test('refuses denied or revoked view permission before publishing health', async () => {
        const f = fixture()
        f.authorize.mockRejectedValue(new Error('permission denied'))
        await expect(f.read(id)).rejects.toThrow('permission denied')
        expect(f.readDesired).not.toHaveBeenCalled()
        expect(f.readHealth).not.toHaveBeenCalled()
        const revoked = fixture()
        revoked.readDesired
            .mockResolvedValueOnce(desired)
            .mockRejectedValueOnce(new Error('permission revoked'))
        await expect(revoked.read(id)).rejects.toThrow('permission revoked')
    })
    test('disabled and single-target hosts return desired unknown members without fetching', async () => {
        await Promise.all(
            [
                { ...desired, enabled: false },
                { ...desired, hasPool: false },
            ].map(async (state) => {
                const f = fixture()
                f.readDesired.mockResolvedValue(state)
                expect((await f.read(id)).state).toBe('unknown')
                expect(f.readHealth).not.toHaveBeenCalled()
            }),
        )
    })
    test('never presents stale, mismatched, inconsistent or failed observations as available', async () => {
        const observations: (ProxyHostUpstreamHealth | null)[] = [
            null,
            healthy({ revision: 'sha256:' + 'b'.repeat(64) }),
            healthy({ observedAt: null }),
            healthy({ observedAt: new Date(now - 30_001).toISOString() }),
            healthy({ observedAt: new Date(now + 5_001).toISOString() }),
            healthy({ hostId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020' }),
            healthy({ members: healthy().members.toReversed() }),
            healthy({ members: healthy().members.slice(0, 1) }),
            healthy({
                members: healthy().members.map((member) =>
                    Object.assign({}, member, { state: 'unavailable' as const }),
                ),
            }),
        ]
        await Promise.all(
            observations.map(async (observation) => {
                const f = fixture()
                f.readHealth.mockResolvedValue(observation)
                const result = await f.read(id)
                expect(result).toEqual({
                    hostId: id,
                    revision: null,
                    observedAt: null,
                    state: 'unknown',
                    members: desired.members.map((member, index) => ({
                        index,
                        ...member,
                        state: 'unknown',
                    })),
                })
            }),
        )
        const f = fixture()
        f.readHealth.mockRejectedValue(new Error('offline'))
        expect((await f.read(id)).state).toBe('unknown')
    })
    test('rechecks the desired revision after controller I/O and does not cache a previous happy result', async () => {
        const f = fixture()
        expect((await f.read(id)).state).toBe('available')
        f.readDesired.mockResolvedValueOnce(desired).mockResolvedValueOnce({
            ...desired,
            revision: 'sha256:' + 'b'.repeat(64),
            members: desired.members.toReversed(),
        })
        const result = await f.read(id)
        expect(result.state).toBe('unknown')
        expect(result.members[0]?.host).toBe('secondary.internal')
        f.readHealth.mockResolvedValue(null)
        expect((await f.read(id)).state).toBe('unknown')
    })
})

const envNames = ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'] as const
const originalEnv = new Map(envNames.map((key) => [key, process.env[key]]))
afterEach(() => {
    mock.restore()
    for (const key of envNames) {
        const value = originalEnv.get(key)
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
})
test('controller health transport authenticates, bounds and validates the selected host response', async () => {
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'a'.repeat(64)
    const fetcher = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(healthy()))
    expect(await getProxyHostUpstreamHealth(id)).toEqual(healthy())
    expect(String(fetcher.mock.calls[0]?.[0])).toEndWith(`/internal/v1/proxy/hosts/${id}/upstreams`)
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
        'Bearer ' + 'a'.repeat(64),
    )
    for (const payload of [
        healthy({ hostId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020' }),
        {
            ...healthy(),
            members: [{ index: 0, host: 'primary.internal', port: 8080, state: 'healthy' }],
        },
        { ...healthy(), extra: true },
        { ...healthy(), padding: 'x'.repeat(17_000) },
    ]) {
        fetcher.mockResolvedValue(Response.json(payload))
        // oxlint-disable-next-line no-await-in-loop -- Each case replaces the shared fetch response before consuming it.
        expect(await getProxyHostUpstreamHealth(id)).toBeNull()
    }
    const count = fetcher.mock.calls.length
    expect(await getProxyHostUpstreamHealth('../other')).toBeNull()
    expect(fetcher.mock.calls.length).toBe(count)
})
