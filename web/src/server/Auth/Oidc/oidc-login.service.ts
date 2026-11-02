import '@tanstack/react-start/server-only'
import { getPublicOrigin } from '@/server/env.server.ts'
import { OIDC_CALLBACK_PATH, OIDC_LIMITS } from '@/config/oidc.config.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { createOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import { createSessionInTransaction } from '@/server/Auth/Access/sessions.service.ts'
import {
    createOidcLoginMfaChallengeService,
    getLoginMfaFactorInTransaction,
} from '@/server/Auth/TwoFactor/two-factor.service.ts'
import { recordAuditEventBestEffortService } from '@/server/Audit/audit.service.ts'
import { requireOidcAuthenticationInTransaction } from './oidc-authentication.server.ts'
import {
    getOidcClientConfigurationService,
    readOidcProviderService,
} from './oidc-providers.service.ts'
import { oidcProtocolClient } from './oidc-client.server.ts'
import { oidcFlowStore } from './oidc-state.server.ts'
import { OidcDomainError } from './oidc.errors.ts'
import type { OidcFlowDependencies } from './Types/oidc-flow.types.ts'
import type { OidcClientConfiguration, OidcVerifiedIdentity } from './Types/oidc.types.ts'
import type { LoginResult } from '@/server/Auth/Core/Types/auth-service.types.ts'

/** Connects one-time OIDC proof to the existing local session and MFA lifecycle. */
export function createOidcLoginService(dependencies: OidcFlowDependencies) {
    let active = 0
    /** Caps outstanding provider operations and releases admission on every completion path. */
    async function admitted<T>(run: () => Promise<T>): Promise<T> {
        if (active >= OIDC_LIMITS.activeExchanges) throw new OidcDomainError('provider_unavailable')
        active += 1
        try {
            return await run()
        } finally {
            active -= 1
        }
    }
    /** Pins callbacks to deployment configuration rather than forwarded request headers. */
    function redirectUri() {
        const origin = dependencies.origin()
        if (!origin) throw new OidcDomainError('configuration_unavailable')
        return new URL(OIDC_CALLBACK_PATH, origin).href
    }
    return {
        /** Binds a fresh authorization attempt to the provider generation, browser and callback URI. */
        beginOidcLoginService(providerId: string) {
            return admitted(async () => {
                const configuration = await dependencies.configuration(providerId)
                const flow = {
                    providerId: configuration.providerId,
                    providerRevision: configuration.revision,
                    issuer: configuration.issuer,
                    redirectUri: redirectUri(),
                    nonce: createOpaqueToken(),
                    codeVerifier: createOpaqueToken(),
                }
                const issued = await dependencies.state.issue(flow)
                const authorizationUrl = await dependencies.protocol.buildAuthorizationUrl(
                    configuration,
                    { ...flow, state: issued.state },
                )
                return { ...issued, authorizationUrl }
            }).catch(() => {
                throw new OidcDomainError('provider_unavailable')
            })
        },
        /** Consumes browser proof before redemption and rechecks trust before local authentication. */
        completeOidcLoginService(callback: URL, browserToken: string) {
            return admitted(async () => {
                try {
                    const state = callback.searchParams.get('state') ?? ''
                    const flow = await dependencies.state.consume(state, browserToken)
                    if (
                        !flow ||
                        flow.redirectUri !== redirectUri() ||
                        callback.origin + callback.pathname !== flow.redirectUri
                    )
                        throw new OidcDomainError('challenge_expired')
                    const configuration = await dependencies.configuration(flow.providerId)
                    if (
                        configuration.revision !== flow.providerRevision ||
                        configuration.issuer !== flow.issuer
                    )
                        throw new OidcDomainError('authentication_failed')
                    const identity = await dependencies.protocol.exchangeAuthorizationCode(
                        configuration,
                        { ...flow, state },
                        callback,
                    )
                    if (identity.issuer !== flow.issuer)
                        throw new OidcDomainError('authentication_failed')
                    const result = await dependencies.authenticate(configuration, identity)
                    if (!result.success) throw new OidcDomainError('authentication_failed')
                    return result
                } catch {
                    await dependencies.failed().catch(() => {})
                    throw new OidcDomainError('authentication_failed')
                }
            })
        },
    }
}

/** Revalidates a verified external identity and applies the installation's local access policy. */
export async function authenticateOidcIdentityService(
    configuration: OidcClientConfiguration,
    identity: OidcVerifiedIdentity,
): Promise<LoginResult> {
    const provider = await readOidcProviderService(configuration.providerId)
    const binding = provider?.bindings.find((entry) => entry.subject === identity.subject)
    if (!binding || provider?.issuer !== identity.issuer)
        throw new OidcDomainError('identity_not_allowed')
    const proof = {
        providerId: configuration.providerId,
        providerRevision: configuration.revision,
        issuer: identity.issuer,
        subject: identity.subject,
        userId: binding.userId,
    }
    return getAuthDatabase().transaction(async (transaction) => {
        await requireOidcAuthenticationInTransaction(transaction, proof)
        const factor = await getLoginMfaFactorInTransaction(transaction, proof.userId)
        if (factor) {
            const challenge = await createOidcLoginMfaChallengeService({
                ...proof,
                factorId: factor.id,
            })
            return { success: true as const, requiresTwoFactor: true as const, challenge }
        }
        const session = await createSessionInTransaction(
            transaction,
            proof.userId,
            'oidc',
            new Date(0),
        )
        return {
            success: true as const,
            requiresTwoFactor: false as const,
            user: session.user,
            session: { id: session.id, token: session.token, expiresAt: session.expiresAt },
        }
    })
}

export const { beginOidcLoginService, completeOidcLoginService } = createOidcLoginService({
    origin: getPublicOrigin,
    configuration: getOidcClientConfigurationService,
    state: oidcFlowStore,
    protocol: oidcProtocolClient,
    authenticate: authenticateOidcIdentityService,
    failed: async () => {
        await recordAuditEventBestEffortService({
            actorUserId: null,
            actorKind: 'anonymous',
            action: 'login',
            resource: 'session',
            targetId: null,
            result: 'failure',
            metadata: { authenticationMethod: 'oidc', reason: 'authentication_failed' },
        })
    },
})
