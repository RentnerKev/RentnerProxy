import { expect, mock, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'

mock.module('@/server/Auth/Oidc/oidc-providers.service.ts', () => ({
    getPublicOidcProvidersService: async () => [],
}))
const { createOidcPublicCatalogCache } =
    await import('@/server/Auth/Oidc/oidc-public-catalog.server.ts')

const provider = { id: '0194f777-4074-7000-8000-000000000003', name: 'Office' }

test('concurrent catalog reads share a single load and retain only isolated public metadata', async () => {
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
        release = resolve
    })
    const source = [
        { ...provider, clientSecret: 'private credential', bindings: [{ userId: 'private user' }] },
    ]
    const load = mock(async () => {
        await pending
        return source
    })
    const report = mock((_code: string) => {})
    const getCatalog = createOidcPublicCatalogCache({ load, now: () => 0, report })
    const first = getCatalog()
    const second = getCatalog()
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    release!()
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual([provider])
    expect(b).toEqual([provider])
    a[0]!.name = 'poisoned response'
    a.push({ id: 'injected', name: 'Injected' })
    source[0]!.name = 'poisoned loader result'
    expect(b).toEqual([provider])
    expect(await getCatalog()).toEqual([provider])
    expect(JSON.stringify(await getCatalog())).not.toContain('private')
    expect(report).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
})

test('successful catalog snapshots expire at the bounded TTL and coalesce the refresh', async () => {
    let now = 0
    const load = mock(async () => [provider])
    const getCatalog = createOidcPublicCatalogCache({ load, now: () => now, report: () => {} })
    expect(await getCatalog()).toEqual([provider])
    now = OIDC_LIMITS.publicCatalogCacheMs - 1
    expect(await getCatalog()).toEqual([provider])
    expect(load).toHaveBeenCalledTimes(1)
    load.mockResolvedValue([{ ...provider, name: 'Renamed' }])
    now += 1
    expect(await Promise.all([getCatalog(), getCatalog()])).toEqual([
        [{ ...provider, name: 'Renamed' }],
        [{ ...provider, name: 'Renamed' }],
    ])
    expect(load).toHaveBeenCalledTimes(2)
})

test('outages cache the empty fallback, bound sanitized diagnostics and recover after expiry', async () => {
    let now = 0
    const load = mock(async () => [provider])
    load.mockRejectedValueOnce(new Error('private database connection or credential details'))
    const report = mock((_code: string) => {})
    const getCatalog = createOidcPublicCatalogCache({ load, now: () => now, report })
    const results = await Promise.all([getCatalog(), getCatalog(), getCatalog()])
    expect(results).toEqual([[], [], []])
    results[0]!.push({ id: 'injected', name: 'Injected' })
    now = OIDC_LIMITS.publicCatalogCacheMs - 1
    expect(await getCatalog()).toEqual([])
    expect(load).toHaveBeenCalledTimes(1)
    expect(report.mock.calls).toEqual([['provider_catalog_unavailable']])
    now += 1
    expect(await getCatalog()).toEqual([provider])
    expect(load).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledTimes(1)
})

test('persistent failures reload and report at most once per TTL even if reporting throws', async () => {
    let now = 0
    const load = mock(async (): Promise<(typeof provider)[]> => {
        throw new Error('private diagnostic')
    })
    const report = mock((_code: string) => {
        throw new Error('private logger diagnostic')
    })
    const getCatalog = createOidcPublicCatalogCache({ load, now: () => now, report })
    expect(await Promise.all([getCatalog(), getCatalog()])).toEqual([[], []])
    expect(await getCatalog()).toEqual([])
    expect(load).toHaveBeenCalledTimes(1)
    expect(report.mock.calls).toEqual([['provider_catalog_unavailable']])
    now += OIDC_LIMITS.publicCatalogCacheMs
    expect(await Promise.all([getCatalog(), getCatalog()])).toEqual([[], []])
    expect(load).toHaveBeenCalledTimes(2)
    expect(report.mock.calls).toEqual([
        ['provider_catalog_unavailable'],
        ['provider_catalog_unavailable'],
    ])
})
