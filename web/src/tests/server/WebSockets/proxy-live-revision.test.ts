import { expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { ProxyRuntimeStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import { createProxyLiveRevisionReader } from '@/server/WebSockets/proxy-live-revision.ts'

test.each([
    ['proxy-hosts', PERMISSIONS.PROXY_HOSTS_VIEW],
    ['redirect-hosts', PERMISSIONS.REDIRECT_HOSTS_VIEW],
    ['access-policies', PERMISSIONS.ACCESS_POLICIES_VIEW],
] as const)(
    'each %s poll authorizes before any database or controller read',
    async (topic, permission) => {
        const events: string[] = []
        let allowed = false
        const read = createProxyLiveRevisionReader({
            authorize: async (checkedPermission) => {
                events.push(checkedPermission)
                if (!allowed) throw new Error('Denied')
            },
            readDigest: async () => {
                events.push('database')
                return 'a'.repeat(64)
            },
            readRuntime: async () => {
                events.push('controller')
                return null
            },
        })
        events.length = 0
        await expect(read(topic)).rejects.toThrow('Denied')
        expect(events).toEqual([permission])
        allowed = true
        await read(topic)
        expect(events).toEqual([permission, permission, 'database', 'controller'])
        allowed = false
        await expect(read(topic)).rejects.toThrow('Denied')
        expect(events.at(-1)).toBe(permission)
    },
)

test('only aggregate invalidation revision leaves the reader, including desired and runtime changes', async () => {
    let digest = 'a'.repeat(64)
    let runtime: ProxyRuntimeStatus | null = null
    const read = createProxyLiveRevisionReader({
        authorize: async () => undefined,
        readDigest: async () => digest,
        readRuntime: async () => runtime,
    })
    const first = await read('proxy-hosts')
    expect(Object.keys(first)).toEqual(['revision'])
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(await read('proxy-hosts')).toEqual(first)
    expect(await read('redirect-hosts')).not.toEqual(first)
    digest = 'b'.repeat(64)
    const desiredChanged = await read('proxy-hosts')
    expect(desiredChanged).not.toEqual(first)
    runtime = { available: true, running: true, activeRevision: 'active', lastApplyAt: null }
    const activated = await read('proxy-hosts')
    expect(activated).not.toEqual(desiredChanged)
    await [
        { available: false },
        { running: false },
        { activeRevision: 'other' },
        { lastApplyAt: '2026-10-22T00:00:00Z' },
    ].reduce(async (previous, update) => {
        await previous
        const before = await read('proxy-hosts')
        if (!runtime) throw new Error('Expected current controller status')
        runtime = { ...runtime, ...update }
        expect(await read('proxy-hosts')).not.toEqual(before)
    }, Promise.resolve())
    digest = 'invalid'
    await expect(read('proxy-hosts')).rejects.toThrow('Invalid live database digest')
})
