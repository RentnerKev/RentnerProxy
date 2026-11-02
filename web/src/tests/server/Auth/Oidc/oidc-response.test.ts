import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { OIDC_FLOW_COOKIE_NAME, OIDC_DEVELOPMENT_FLOW_COOKIE_NAME } from '@/config/oidc.config.ts'
import { SESSION_COOKIE_NAME, MFA_CHALLENGE_COOKIE_NAME } from '@/config/auth.config.ts'
import { createOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import { createOidcHttpHandlers } from '@/server/Auth/Oidc/oidc-response.server.ts'
import type { LoginResult } from '@/server/Auth/Core/Types/auth-service.types.ts'

const providerId = '0194f777-4074-7000-8000-000000000001'
function fixture(
    origin = 'https://proxy.example.test',
    authorizationUrl = new URL('https://identity.example.test/authorize?state=opaque'),
) {
    const browserToken = createOpaqueToken()
    const state = createOpaqueToken()
    const sessionToken = createOpaqueToken()
    let begins = 0
    let completes = 0
    let signedIn = false
    let fail = false
    let result: Extract<LoginResult, { success: true }> = {
        success: true,
        requiresTwoFactor: false,
        user: {
            id: providerId,
            displayName: 'Fixture',
            email: 'fixture@example.test',
            profileImageVersion: null,
            roles: ['viewer'],
            permissions: ['app.access'],
            language: 'en',
            themeMode: 'dark',
        },
        session: { id: providerId, token: sessionToken, expiresAt: new Date(Date.now() + 60_000) },
    }
    const handlers = createOidcHttpHandlers({
        origin: () => origin,
        limit: async () => {},
        signedIn: async () => signedIn,
        begin: async (id) => {
            expect(id).toBe(providerId)
            begins += 1
            return {
                state,
                browserToken,
                authorizationUrl,
                expiresAt: new Date(Date.now() + 60_000),
            }
        },
        complete: async (url, token) => {
            completes += 1
            expect(url.origin).toBe(origin)
            expect(url.pathname).toBe('/api/auth/oidc/callback')
            expect(token).toBe(browserToken)
            if (fail) throw new Error('provider-raw-token-payload')
            return result
        },
    })
    const cookieName = origin.startsWith('https:')
        ? OIDC_FLOW_COOKIE_NAME
        : OIDC_DEVELOPMENT_FLOW_COOKIE_NAME
    const start = (headers: HeadersInit = {}) =>
        new Request('http://internal:3000/api/auth/oidc/start', {
            method: 'POST',
            headers: { origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
            body: new URLSearchParams({ providerId }),
        })
    const callback = (
        query = `state=${state}&code=one-time-fixture-code`,
        cookies = `${cookieName}=${browserToken}`,
    ) =>
        new Request(`http://internal:3000/api/auth/oidc/callback?${query}`, {
            headers: { cookie: cookies },
        })
    return {
        handlers,
        start,
        callback,
        browserToken,
        sessionToken,
        state,
        begins: () => begins,
        completes: () => completes,
        signedIn: () => {
            signedIn = true
        },
        fail: () => {
            fail = true
        },
        mfa: () => {
            result = {
                success: true,
                requiresTwoFactor: true,
                challenge: { id: createOpaqueToken(), expiresAt: new Date(Date.now() + 60_000) },
            }
        },
    }
}

/** Parses the emitted attributes with an HTML parser to detect element or attribute injection. */
async function parseNavigationBridge(response: Response) {
    const body = await response.text()
    const window = new Window()
    try {
        const document = new window.DOMParser().parseFromString(body, 'text/html')
        return {
            body,
            refresh: [...document.querySelectorAll('meta[http-equiv="refresh"]')].map((element) =>
                element.getAttribute('content'),
            ),
            links: [...document.querySelectorAll('a')].map((element) =>
                element.getAttribute('href'),
            ),
            scripts: document.querySelectorAll('script').length,
            injectedElements: document.querySelectorAll(
                '[onload], [onclick], [autofocus], svg, img, form',
            ).length,
        }
    } finally {
        await window.happyDOM.close()
    }
}

describe('OIDC raw HTTP endpoints', () => {
    test('starts with a no-store HTML navigation bridge and host-only browser binding under form-action self', async () => {
        const value = fixture()
        const response = await value.handlers.start(value.start())
        expect(response.status).toBe(200)
        expect(response.headers.get('location')).toBeNull()
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
        const cookies = response.headers.getSetCookie().join(';')
        expect(cookies).toContain(`${OIDC_FLOW_COOKIE_NAME}=${value.browserToken}`)
        for (const flag of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'])
            expect(cookies).toContain(flag)
        expect(cookies).not.toContain('Domain=')
        expect(response.headers.get('cache-control')).toContain('no-store')
        expect(response.headers.get('referrer-policy')).toBe('no-referrer')
        const bridge = await parseNavigationBridge(response)
        expect(bridge.refresh).toEqual([
            '0;url=https://identity.example.test/authorize?state=opaque',
        ])
        expect(bridge.links).toEqual(['https://identity.example.test/authorize?state=opaque'])
        expect(bridge.scripts).toBe(0)
        expect(bridge.injectedElements).toBe(0)
        expect(bridge.body).not.toContain(value.browserToken)
        expect(bridge.body).not.toContain(value.sessionToken)
    })

    test('escapes all HTML metacharacters in both navigation attributes without changing the destination', async () => {
        const destination = `https://identity.example.test/authorize?state=opaque&client_id=a'"<svg onload=alert(1)>&entity=&quot;`
        const authorizationUrl = new URL('https://identity.example.test/authorize')
        // Exercise the rendering boundary without relying on URL serialization to pre-encode hostile metacharacters.
        Object.defineProperty(authorizationUrl, 'href', { value: destination })
        const value = fixture(undefined, authorizationUrl)
        const response = await value.handlers.start(value.start())
        expect(response.status).toBe(200)
        expect(response.headers.get('location')).toBeNull()
        const bridge = await parseNavigationBridge(response)
        expect(bridge.refresh).toEqual(['0;url=' + destination])
        expect(bridge.links).toEqual([destination])
        expect(bridge.scripts).toBe(0)
        expect(bridge.injectedElements).toBe(0)
        expect(bridge.body).toContain('&amp;client_id=a&#39;&quot;&lt;svg onload=alert(1)&gt;')
        expect(bridge.body).toContain('&amp;entity=&amp;quot;')
        expect(bridge.body).not.toContain('<svg')
    })

    for (const suppliedOrigin of ['null', null]) {
        test(`accepts a privacy-preserved same-origin native navigation with ${suppliedOrigin === null ? 'absent' : 'null'} Origin`, async () => {
            const value = fixture()
            const request = value.start({
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-dest': 'document',
            })
            if (suppliedOrigin === null) request.headers.delete('origin')
            else request.headers.set('origin', suppliedOrigin)
            const response = await value.handlers.start(request)
            expect(response.status).toBe(200)
            expect(response.headers.get('location')).toBeNull()
            expect(response.headers.get('referrer-policy')).toBe('no-referrer')
            expect(response.headers.getSetCookie().join(';')).toContain(
                `${OIDC_FLOW_COOKIE_NAME}=${value.browserToken}`,
            )
            expect(value.begins()).toBe(1)
        })
    }

    const navigationMetadata = {
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
    }
    const invalidMetadata: { label: string; headers: Record<string, string> }[] = [
        { label: 'missing all metadata', headers: {} },
        {
            label: 'missing site',
            headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
        },
        {
            label: 'missing mode',
            headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' },
        },
        {
            label: 'missing destination',
            headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' },
        },
        ...['same-site', 'cross-site', 'none', 'same-origin, same-origin'].map((site) => ({
            label: `site=${site}`,
            headers: { ...navigationMetadata, 'sec-fetch-site': site },
        })),
        ...['cors', 'no-cors', 'navigate, navigate'].map((mode) => ({
            label: `mode=${mode}`,
            headers: { ...navigationMetadata, 'sec-fetch-mode': mode },
        })),
        ...['iframe', 'empty', 'document, document'].map((destination) => ({
            label: `destination=${destination}`,
            headers: { ...navigationMetadata, 'sec-fetch-dest': destination },
        })),
    ]
    for (const suppliedOrigin of ['null', null]) {
        for (const metadata of invalidMetadata) {
            test(`rejects ${suppliedOrigin === null ? 'absent' : 'null'} Origin with ${metadata.label}`, async () => {
                const value = fixture()
                const request = value.start(metadata.headers)
                if (suppliedOrigin === null) request.headers.delete('origin')
                else request.headers.set('origin', suppliedOrigin)
                request.headers.set('referer', 'https://proxy.example.test/login')
                const response = await value.handlers.start(request)
                expect(response.status).toBe(403)
                expect(response.headers.getSetCookie()).toHaveLength(0)
                expect(value.begins()).toBe(0)
            })
        }
    }

    for (const suppliedOrigin of [
        'https://attacker.example.test',
        'https://proxy.example.test.attacker.example',
        '',
        'null, https://proxy.example.test',
    ]) {
        test(`rejects explicit untrusted Origin ${JSON.stringify(suppliedOrigin)} despite claimed same-origin metadata`, async () => {
            const value = fixture()
            const response = await value.handlers.start(
                value.start({ ...navigationMetadata, origin: suppliedOrigin }),
            )
            expect(response.status).toBe(403)
            expect(response.headers.getSetCookie()).toHaveLength(0)
            expect(value.begins()).toBe(0)
        })
    }

    test('rejects foreign origins, duplicate parameters, oversized bodies and unsupported methods', async () => {
        const value = fixture()
        expect(
            (await value.handlers.start(value.start({ origin: 'https://attacker.example.test' })))
                .status,
        ).toBe(403)
        expect(
            (
                await value.handlers.start(
                    new Request('https://proxy.example.test/api/auth/oidc/start'),
                )
            ).status,
        ).toBe(405)
        const responses = await Promise.all(
            [
                `providerId=${providerId}&providerId=${providerId}`,
                `providerId=${providerId}&returnTo=https://attacker.example.test`,
                'providerId=' + 'a'.repeat(300),
            ].map((body) =>
                value.handlers.start(
                    new Request('https://proxy.example.test/api/auth/oidc/start', {
                        method: 'POST',
                        headers: {
                            origin: 'https://proxy.example.test',
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body,
                    }),
                ),
            ),
        )
        for (const response of responses)
            expect(response.headers.get('location')).toBe('/login?oidcError=failed')
        expect(value.begins()).toBe(0)
    })

    test('sets the existing session cookie and clears binding only after successful verification behind a proxy', async () => {
        const value = fixture()
        const response = await value.handlers.callback(value.callback())
        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe('/')
        const cookies = response.headers.getSetCookie()
        expect(
            cookies.some((entry) =>
                entry.startsWith(`${SESSION_COOKIE_NAME}=${value.sessionToken};`),
            ),
        ).toBeTrue()
        expect(
            cookies.some(
                (entry) => entry.startsWith(`${OIDC_FLOW_COOKIE_NAME}=;`) && entry.includes('1970'),
            ),
        ).toBeTrue()
        expect(
            cookies.every((entry) => entry.includes('HttpOnly') && entry.includes('Secure')),
        ).toBeTrue()
        expect(await response.text()).toBe('')
        expect(value.completes()).toBe(1)
    })

    test('routes a locally protected account into the existing MFA screen without issuing a session', async () => {
        const value = fixture()
        value.mfa()
        const response = await value.handlers.callback(value.callback())
        expect(response.headers.get('location')).toBe('/login/two-factor')
        expect(
            response.headers
                .getSetCookie()
                .some(
                    (entry) =>
                        entry.startsWith(MFA_CHALLENGE_COOKIE_NAME + '=') &&
                        !entry.includes('1970'),
                ),
        ).toBeTrue()
        expect(
            response.headers
                .getSetCookie()
                .some((entry) => entry.startsWith(SESSION_COOKIE_NAME + '=')),
        ).toBeFalse()
    })

    test('unrelated malformed callbacks preserve the browser cookie and cannot burn a pending exchange', async () => {
        const value = fixture()
        const responses = await Promise.all(
            [
                'state=wrong&state=again',
                `state=${value.state}&code=x&access_token=must-not-be-accepted`,
                `state=${value.state}&id_token=must-not-be-accepted`,
            ].map((query) => value.handlers.callback(value.callback(query))),
        )
        for (const response of responses) {
            expect(response.headers.get('location')).toBe('/login?oidcError=failed')
            expect(response.headers.getSetCookie()).toHaveLength(0)
        }
        expect(value.completes()).toBe(0)
        expect((await value.handlers.callback(value.callback())).headers.get('location')).toBe('/')
    })

    test('rejects tossed development cookies and duplicate browser cookies on HTTPS', async () => {
        const value = fixture()
        const responses = await Promise.all(
            [
                `${OIDC_DEVELOPMENT_FLOW_COOKIE_NAME}=${value.browserToken}`,
                `${OIDC_FLOW_COOKIE_NAME}=${value.browserToken}; ${OIDC_FLOW_COOKIE_NAME}=${value.browserToken}`,
            ].map((cookieHeader) =>
                value.handlers.callback(value.callback(undefined, cookieHeader)),
            ),
        )
        for (const response of responses)
            expect(response.headers.get('location')).toBe('/login?oidcError=failed')
        expect(value.completes()).toBe(0)
    })

    test('ignores bounded response extensions without allowing return redirects or protocol data in errors', async () => {
        const value = fixture()
        const response = await value.handlers.callback(
            value.callback(
                `state=${value.state}&code=one-time-fixture-code&scope=openid&returnTo=https://attacker.example.test`,
            ),
        )
        expect(response.headers.get('location')).toBe('/')
        value.fail()
        const failure = await value.handlers.callback(value.callback())
        expect(failure.headers.get('location')).toBe('/login?oidcError=failed')
        expect(JSON.stringify([...failure.headers])).not.toContain('provider-raw-token-payload')
        expect(await failure.text()).toBe('')
        expect(failure.headers.getSetCookie()).toHaveLength(0)
    })

    test('uses a separate HTTP development cookie and preserves an already authenticated session', async () => {
        const value = fixture('http://localhost:5173')
        const response = await value.handlers.start(value.start())
        expect(response.headers.getSetCookie()[0]).toStartWith(
            OIDC_DEVELOPMENT_FLOW_COOKIE_NAME + '=',
        )
        expect(response.headers.getSetCookie()[0]).not.toContain('Secure')
        value.signedIn()
        expect((await value.handlers.callback(value.callback())).headers.get('location')).toBe('/')
        expect(value.completes()).toBe(0)
    })
})
