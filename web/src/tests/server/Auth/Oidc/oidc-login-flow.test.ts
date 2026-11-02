import { describe, expect, test } from 'bun:test'
import { createOidcLoginService } from '@/server/Auth/Oidc/oidc-login.service.ts'
import { createOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import type { OidcFlow, OidcFlowDependencies } from '@/server/Auth/Oidc/Types/oidc-flow.types.ts'
import type { OidcClientConfiguration } from '@/server/Auth/Oidc/Types/oidc.types.ts'

function fixture() {
    let flow: OidcFlow | undefined
    let revision = 3
    let origin = 'https://proxy.example.test'
    let accepted = 0
    let failed = 0
    const state = createOpaqueToken()
    const browserToken = createOpaqueToken()
    const configuration: OidcClientConfiguration = {
        providerId: '0194f777-4074-7000-8000-000000000001',
        revision,
        issuer: 'https://identity.example.test/realm',
        clientId: 'fixture',
        clientSecret: 'fixture-secret',
        tokenEndpointAuthMethod: 'client_secret_basic',
        allowedEndpointOrigins: ['https://identity.example.test'],
        allowedPrivateCidrs: [],
    }
    const dependencies: OidcFlowDependencies = {
        origin: () => origin,
        configuration: async () => ({ ...configuration, revision }),
        state: {
            issue: async (value) => {
                flow = value
                return { state, browserToken, expiresAt: new Date(Date.now() + 60_000) }
            },
            consume: async (value, cookie) => {
                if (value !== state || cookie !== browserToken) return null
                const valueFlow = flow
                flow = undefined
                return valueFlow ?? null
            },
        },
        protocol: {
            buildAuthorizationUrl: async (_configuration, request) => {
                expect(request.state).toBe(state)
                expect(request.nonce).toHaveLength(43)
                expect(request.codeVerifier).toHaveLength(43)
                return new URL('https://identity.example.test/authorize')
            },
            exchangeAuthorizationCode: async (_configuration, request, callback) => {
                expect(callback.searchParams.get('code')).toBe('one-time-fixture-code')
                expect(request.state).toBe(state)
                return { issuer: configuration.issuer, subject: 'immutable-subject' }
            },
        },
        authenticate: async () => {
            accepted += 1
            return {
                success: true,
                requiresTwoFactor: true,
                challenge: { id: createOpaqueToken(), expiresAt: new Date(Date.now() + 60_000) },
            }
        },
        failed: async () => {
            failed += 1
        },
    }
    const service = createOidcLoginService(dependencies)
    const callback = () =>
        new URL(`${origin}/api/auth/oidc/callback?code=one-time-fixture-code&state=${state}`)
    return {
        service,
        dependencies,
        configuration,
        browserToken,
        callback,
        accepted: () => accepted,
        failed: () => failed,
        changeRevision: () => {
            revision += 1
        },
        changeOrigin: () => {
            origin = 'https://other.example.test'
        },
    }
}

describe('OIDC login orchestration', () => {
    test('binds protocol proof to one browser and one local MFA admission', async () => {
        const fixtureValue = fixture()
        await fixtureValue.service.beginOidcLoginService(fixtureValue.configuration.providerId)
        await expect(
            fixtureValue.service.completeOidcLoginService(
                fixtureValue.callback(),
                createOpaqueToken(),
            ),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
        expect(fixtureValue.accepted()).toBe(0)
        expect(
            (
                await fixtureValue.service.completeOidcLoginService(
                    fixtureValue.callback(),
                    fixtureValue.browserToken,
                )
            ).requiresTwoFactor,
        ).toBeTrue()
        await expect(
            fixtureValue.service.completeOidcLoginService(
                fixtureValue.callback(),
                fixtureValue.browserToken,
            ),
        ).rejects.toMatchObject({ code: 'authentication_failed' })
        expect(fixtureValue.accepted()).toBe(1)
    })

    for (const change of ['revision', 'origin'] as const)
        test(`rejects changed ${change} before issuing a session`, async () => {
            const value = fixture()
            await value.service.beginOidcLoginService(value.configuration.providerId)
            if (change === 'revision') value.changeRevision()
            else value.changeOrigin()
            await expect(
                value.service.completeOidcLoginService(value.callback(), value.browserToken),
            ).rejects.toMatchObject({ code: 'authentication_failed' })
            expect(value.accepted()).toBe(0)
            expect(value.failed()).toBe(1)
        })

    test('uses safe errors and consumes failed protocol proof without a second redemption', async () => {
        const value = fixture()
        value.dependencies.protocol.exchangeAuthorizationCode = async () => {
            throw new Error('raw-token-and-provider-payload')
        }
        await value.service.beginOidcLoginService(value.configuration.providerId)
        await expect(
            value.service.completeOidcLoginService(value.callback(), value.browserToken),
        ).rejects.toThrow('authentication_failed')
        expect(value.accepted()).toBe(0)
        await expect(
            value.service.completeOidcLoginService(value.callback(), value.browserToken),
        ).rejects.toThrow('authentication_failed')
    })

    test('caps concurrent exchanges and releases admission after a rejected operation', async () => {
        const value = fixture()
        let release!: () => void
        const wait = new Promise<void>((resolve) => {
            release = resolve
        })
        const service = createOidcLoginService({
            ...value.dependencies,
            configuration: async () => {
                await wait
                throw new Error('provider offline')
            },
        })
        const pending = Array.from({ length: 8 }, () =>
            service.beginOidcLoginService(value.configuration.providerId).catch(() => null),
        )
        await expect(
            service.beginOidcLoginService(value.configuration.providerId),
        ).rejects.toMatchObject({ code: 'provider_unavailable' })
        release()
        await Promise.all(pending)
        await expect(
            service.beginOidcLoginService(value.configuration.providerId),
        ).rejects.toMatchObject({ code: 'provider_unavailable' })
    })
})
