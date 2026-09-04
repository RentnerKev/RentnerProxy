import { describe, expect, test } from 'bun:test'

import { createProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-snapshot'
import type {
    ProxyRuntimeHost,
    RedirectRuntimeHost,
} from '../server/ProxyRuntime/Types/proxy-runtime.types'

type ProxyInput = ProxyRuntimeHost & { readonly enabled: boolean }
type RedirectInput = RedirectRuntimeHost & { readonly enabled: boolean }

const PROXY_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const REDIRECT_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54020'

function proxy(overrides: Partial<ProxyInput> = {}): ProxyInput {
    return {
        id: PROXY_ID,
        domains: ['proxy.test'],
        enabled: true,
        forwardScheme: 'http',
        forwardHost: 'backend.internal',
        forwardPort: 4_000,
        ...overrides,
    }
}

function redirect(overrides: Partial<RedirectInput> = {}): RedirectInput {
    return {
        id: REDIRECT_ID,
        domains: ['redirect.test'],
        destination: 'https://destination.test/base',
        statusCode: 308,
        preserveRequestUri: true,
        enabled: true,
        certificateId: null,
        ...overrides,
    }
}

function snapshot(
    redirects: ReadonlyArray<RedirectInput>,
    proxies: ReadonlyArray<ProxyInput> = [proxy()],
) {
    return createProxyRuntimeSnapshot(proxies, {}, [], redirects)
}

describe('redirect host runtime snapshots', () => {
    test('emits deterministic v6 state in the cross-language property order', () => {
        const second = redirect({
            id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
            domains: ['z.redirect.test', 'a.redirect.test'],
            destination: 'http://other.test/',
            statusCode: 301,
            preserveRequestUri: false,
        })
        const result = snapshot([second, redirect()])

        expect(result.version).toBe(6)
        expect(Object.keys(result).slice(0, -1)).toEqual([
            'version',
            'proxyHosts',
            'redirectHosts',
            'httpSettings',
            'trustedCas',
        ])
        expect(result.redirectHosts?.map((host) => host.id)).toEqual([REDIRECT_ID, second.id])
        expect(result.redirectHosts?.[1]?.domains).toEqual(['a.redirect.test', 'z.redirect.test'])
        expect(result.revision).toBe(
            'sha256:bc76b6a3a15ec41a362ad7c220fb11e168d21e0cb81dc1f23688ef2ee40083b7',
        )
        expect(snapshot([redirect(), second])).toEqual(result)
    })

    test('keeps legacy snapshots byte-for-byte when no redirect is enabled', () => {
        const legacy = createProxyRuntimeSnapshot([proxy()])
        const withDisabledRedirect = snapshot([
            redirect({ enabled: false, destination: 'not evaluated while disabled' }),
        ])

        expect(withDisabledRedirect).toEqual(legacy)
        expect(withDisabledRedirect.version).toBe(1)
        expect(withDisabledRedirect).not.toHaveProperty('redirectHosts')
    })

    test('makes destination, status, URI preservation and certificates revision-sensitive', () => {
        const base = snapshot([redirect()])
        const variants = [
            redirect({ destination: 'https://destination.test/other' }),
            redirect({ statusCode: 307 }),
            redirect({ preserveRequestUri: false }),
            redirect({ certificateId: '550e8400-e29b-41d4-a716-446655440000' }),
        ]

        for (const variant of variants) {
            expect(snapshot([variant]).revision).not.toBe(base.revision)
        }
    })

    test('rejects cross-type identities/domains and non-canonical or unsafe destinations', () => {
        expect(() => snapshot([redirect({ id: PROXY_ID })])).toThrow()
        expect(() => snapshot([redirect({ domains: ['proxy.test'] })])).toThrow()
        expect(() => snapshot([redirect({ domains: ['same.test', 'same.test'] })])).toThrow()

        for (const destination of [
            'https://destination.test/base/',
            'https://destination.test/base?fixed=1',
            'https://destination.test/base#fragment',
            'https://destination.test/$request_uri',
            'https://destination.test/%0d%0aX-Injected:yes',
            'ftp://destination.test/base',
            'not-a-url',
        ]) {
            expect(
                () => snapshot([redirect({ destination, preserveRequestUri: true })]),
                destination,
            ).toThrow()
        }
    })

    test('accepts exact destinations with query/fragment only when URI preservation is off', () => {
        const destination = 'https://destination.test/exact?fixed=a%2Fb#section'
        const result = snapshot([
            redirect({ destination, preserveRequestUri: false, statusCode: 302 }),
        ])

        expect(result.redirectHosts?.[0]).toMatchObject({
            destination,
            preserveRequestUri: false,
            statusCode: 302,
        })
    })

    test('accepts exactly the four supported redirect status codes', () => {
        for (const statusCode of [301, 302, 307, 308] as const) {
            expect(snapshot([redirect({ statusCode })]).redirectHosts?.[0]?.statusCode).toBe(
                statusCode,
            )
        }
        expect(() =>
            snapshot([redirect({ statusCode: 303 as RedirectInput['statusCode'] })]),
        ).toThrow()
    })
})
