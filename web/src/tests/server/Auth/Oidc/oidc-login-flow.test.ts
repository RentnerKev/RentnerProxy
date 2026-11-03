import { describe, expect, test } from 'bun:test'
import { createOidcLoginService } from '@/server/Auth/Oidc/oidc-login.service.ts'
import { createOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import type { OidcFlow, OidcFlowDependencies } from '@/server/Auth/Oidc/Types/oidc-flow.types.ts'
import type { OidcClientConfiguration } from '@/server/Auth/Oidc/Types/oidc.types.ts'
import { OidcDomainError } from '@/server/Auth/Oidc/oidc.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

function fixture() {
    let flow: OidcFlow | undefined
    let revision = 3
    let origin = 'https://proxy.example.test'
    let accepted = 0
    let failed = 0
    let linked = 0
    let exchanges = 0
    let prompt: string | undefined
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
                prompt = request.prompt
                expect(request.state).toBe(state)
                expect(request.nonce).toHaveLength(43)
                expect(request.codeVerifier).toHaveLength(43)
                return new URL('https://identity.example.test/authorize')
            },
            exchangeAuthorizationCode: async (_configuration, request, callback) => {
                exchanges += 1
                expect(callback.searchParams.get('code')).toBe('one-time-fixture-code')
                expect(request.state).toBe(state)
                return {
                    issuer: configuration.issuer,
                    subject: 'immutable-subject',
                    expiresAt: Date.now() + 120_000,
                }
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
        link: async (_configuration, _identity, target) => {
            expect(target).toEqual(flowTarget)
            linked += 1
        },
        failed: async () => {
            failed += 1
        },
    }
    const service = createOidcLoginService(dependencies)
    const flowTarget = {
        userId: configuration.providerId,
        sessionId: '0194f777-4074-7000-8000-000000000002',
        expectedRevision: 7,
    }
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
        linked: () => linked,
        exchanges: () => exchanges,
        prompt: () => prompt,
        flow: () => flow,
        flowTarget,
        changeRevision: () => {
            revision += 1
        },
        changeOrigin: () => {
            origin = 'https://other.example.test'
        },
    }
}

describe('OIDC login orchestration', () => {
    test('binds explicit linking to fresh local consent and never authenticates a new session', async () => {
        const value = fixture()
        await value.service.beginOidcLoginService(value.configuration.providerId, value.flowTarget)
        expect(value.flow()?.link).toEqual(value.flowTarget)
        expect(value.prompt()).toBe('login')
        expect(
            await value.service.completeOidcLoginService(
                value.callback(),
                value.browserToken,
                true,
            ),
        ).toEqual({ success: true, linked: true })
        expect(value.linked()).toBe(1)
        expect(value.accepted()).toBe(0)
        expect(value.exchanges()).toBe(1)
        await expect(
            value.service.completeOidcLoginService(value.callback(), value.browserToken, true),
        ).rejects.toMatchObject({ code: 'challenge_expired' })
        expect(value.linked()).toBe(1)
    })
    for (const linking of [false, true]) {
        test(`rejects mixed callback intent linking=${linking} before code redemption`, async () => {
            const value = fixture()
            await value.service.beginOidcLoginService(
                value.configuration.providerId,
                linking ? undefined : value.flowTarget,
            )
            await expect(
                value.service.completeOidcLoginService(
                    value.callback(),
                    value.browserToken,
                    linking,
                ),
            ).rejects.toMatchObject({ code: 'challenge_expired' })
            expect(value.exchanges()).toBe(0)
            expect(value.linked()).toBe(0)
            expect(value.accepted()).toBe(0)
            expect(value.failed()).toBe(1)
        })
    }
    test('does not fall back to authentication when linking is unavailable or rejected', async () => {
        for (const unavailable of [true, false]) {
            const value = fixture()
            const { link: _link, ...withoutLink } = value.dependencies
            const service = createOidcLoginService(
                unavailable
                    ? withoutLink
                    : {
                          ...value.dependencies,
                          link: async () => {
                              throw new Error('private-link-details')
                          },
                      },
            )
            // oxlint-disable-next-line no-await-in-loop -- Independent one-time flow fixtures.
            await service.beginOidcLoginService(value.configuration.providerId, value.flowTarget)
            // oxlint-disable-next-line no-await-in-loop -- Independent one-time flow fixtures.
            await expect(
                service.completeOidcLoginService(value.callback(), value.browserToken, true),
            ).rejects.toThrow('authentication_failed')
            expect(value.accepted()).toBe(0)
        }
    })
    test('binds protocol proof to one browser and one local MFA admission', async () => {
        const fixtureValue = fixture()
        await fixtureValue.service.beginOidcLoginService(fixtureValue.configuration.providerId)
        await expect(
            fixtureValue.service.completeOidcLoginService(
                fixtureValue.callback(),
                createOpaqueToken(),
            ),
        ).rejects.toMatchObject({ code: 'challenge_expired' })
        expect(fixtureValue.accepted()).toBe(0)
        expect(
            await fixtureValue.service.completeOidcLoginService(
                fixtureValue.callback(),
                fixtureValue.browserToken,
            ),
        ).toMatchObject({ success: true, requiresTwoFactor: true })
        await expect(
            fixtureValue.service.completeOidcLoginService(
                fixtureValue.callback(),
                fixtureValue.browserToken,
            ),
        ).rejects.toMatchObject({ code: 'challenge_expired' })
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
            ).rejects.toMatchObject({
                code: change === 'revision' ? 'configuration_conflict' : 'challenge_expired',
            })
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
        ).rejects.toThrow('challenge_expired')
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
        ).rejects.toMatchObject({ code: 'authentication_failed' })
    })

    test('preserves only recognized failure categories and still audits every unsuccessful completion', async () => {
        const failures = [
            [new OidcDomainError('identity_not_allowed'), 'identity_not_allowed'],
            [new OidcDomainError('provider_unavailable'), 'provider_unavailable'],
            [new OidcDomainError('configuration_conflict'), 'configuration_conflict'],
            [
                new AuthDomainError('authentication_required', 'secret-subject-token'),
                'authentication_required',
            ],
            [new Error('secret-subject-token'), 'authentication_failed'],
            [
                { code: 'identity_not_allowed', message: 'secret-subject-token' },
                'authentication_failed',
            ],
        ] as const
        for (const [failure, code] of failures) {
            const value = fixture()
            value.dependencies.protocol.exchangeAuthorizationCode = async () => {
                throw failure
            }
            // oxlint-disable-next-line no-await-in-loop -- Each case owns a fresh single-use browser flow.
            await value.service.beginOidcLoginService(value.configuration.providerId)
            // oxlint-disable-next-line no-await-in-loop -- Each case owns a fresh single-use browser flow.
            const error = await value.service
                .completeOidcLoginService(value.callback(), value.browserToken)
                .catch((caught: unknown) => caught)
            expect(error).toBeInstanceOf(OidcDomainError)
            expect(error).toMatchObject({ code, message: code })
            expect(JSON.stringify(error)).not.toContain('secret-subject-token')
            expect(value.failed()).toBe(1)
            expect(value.accepted()).toBe(0)
            // oxlint-disable-next-line no-await-in-loop -- Replay must not redeem the same exchange again.
            await expect(
                value.service.completeOidcLoginService(value.callback(), value.browserToken),
            ).rejects.toMatchObject({ code: 'challenge_expired' })
            expect(value.failed()).toBe(2)
        }
    })

    test('a denied local account does not issue a session and cannot escape the failure audit', async () => {
        const value = fixture()
        const service = createOidcLoginService({
            ...value.dependencies,
            authenticate: async () => ({ success: false, code: 'invalid_credentials' }),
            failed: async () => {
                throw new Error('private-audit-backend-error')
            },
        })
        await service.beginOidcLoginService(value.configuration.providerId)
        await expect(
            service.completeOidcLoginService(value.callback(), value.browserToken),
        ).rejects.toMatchObject({ code: 'identity_not_allowed', message: 'identity_not_allowed' })
    })
})
