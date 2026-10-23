import { expect, test } from 'bun:test'
import { responseCacheSchema } from '@/lib/ResponseCache/responseCache.ts'
import { createProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'
import { getProxyHostFormValues } from '@/lib/Admin/ProxyHostManagement/proxyHostFormValues.ts'
const host = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    domains: ['demo.test'],
    forwardScheme: 'http' as const,
    forwardHost: 'backend.internal',
    forwardPort: 4000,
    enabled: true,
}
const responseCache = { pathPrefixes: ['/assets/'], ttlSeconds: 60 }
test('cache defaults off and independently participates in desired-state hashing', () => {
    const off = createProxyRuntimeSnapshot([host])
    const on = createProxyRuntimeSnapshot([{ ...host, responseCache }])
    expect(off.proxyHosts[0]).not.toHaveProperty('responseCache')
    expect(on.proxyHosts[0]?.responseCache).toEqual(responseCache)
    expect(on.revision).not.toBe(off.revision)
    expect(on.revision).toBe(
        'sha256:75fb60b6690b2c3ba7c6ad7f6326667811e524c1ef43d6dba7ee37bbd1f0794d',
    )
    expect(
        createProxyRuntimeSnapshot([
            { ...host, responseCache: { ...responseCache, ttlSeconds: 30 } },
        ]).revision,
    ).not.toBe(on.revision)
    expect(getProxyHostFormValues('create').responseCache).toBeNull()
})
test('rejects unsafe, empty, duplicate and excessive prefix and TTL rules', () => {
    expect(responseCacheSchema.parse(responseCache)).toEqual(responseCache)
    for (const pathPrefixes of [
        [],
        ['/'],
        ['/api'],
        ['/API/'],
        ['/auth/'],
        ['/admin/'],
        ['/login/'],
        ['/logout/'],
        ['/oauth/'],
        ['/session/'],
        ['/assets/../'],
        ['/assets//'],
        ['/assets/%2e/'],
        ['/assets/?'],
        ['/assets/', '/assets/'],
        Array.from({ length: 17 }, (_, index) => `/assets${index}/`),
    ])
        expect(
            responseCacheSchema.safeParse({ ...responseCache, pathPrefixes }).success,
        ).toBeFalse()
    for (const ttlSeconds of [0, -1, 3601, 1.5, NaN])
        expect(responseCacheSchema.safeParse({ ...responseCache, ttlSeconds }).success).toBeFalse()
    expect(responseCacheSchema.safeParse({ ...responseCache, unlimited: true }).success).toBeFalse()
})
