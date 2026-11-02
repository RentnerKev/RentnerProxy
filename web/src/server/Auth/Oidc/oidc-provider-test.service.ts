import '@tanstack/react-start/server-only'
import { OIDC_CALLBACK_PATH, OIDC_CONFIGURATION_RATE_LIMIT } from '@/config/oidc.config.ts'
import type {
    TestOidcProviderInput,
    OidcProviderTestResult,
} from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import { testOidcProviderSchema } from '@/lib/Auth/Oidc/validation.ts'
import { requireSessionService } from '@/server/Auth/Access/authorization.service.ts'
import { hasOwnerRole } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { oidcProtocolClient } from './oidc-client.server.ts'
import { OidcDomainError } from './oidc.errors.ts'
import { authorizeOidcOwnerInTransaction } from './oidc-providers.service.ts'
import { lockStoredOidcSettings } from './oidc-settings.server.ts'
import type { OidcProviderTestDependencies } from './Types/oidc-provider-test.types.ts'

/** Holds no database locks during network requests and repeats trust and owner checks before success. */
export function createOidcProviderTestService(dependencies: OidcProviderTestDependencies) {
    return async function testOidcProviderService(
        input: TestOidcProviderInput,
    ): Promise<OidcProviderTestResult> {
        const session = await dependencies.session()
        if (!hasOwnerRole(session.user.roles))
            throw new AuthDomainError('owner_required', 'Owner is required.')
        const parsed = testOidcProviderSchema.safeParse(input)
        if (!parsed.success) throw new OidcDomainError('invalid_input')
        await dependencies.limit(session.user.id)
        const read = () =>
            dependencies.transaction(async (transaction) => {
                const settings = await dependencies.lock(transaction)
                await dependencies.authorize(transaction, session)
                const provider = settings.providers.find(
                    (item) => item.id === parsed.data.providerId,
                )
                if (settings.revision !== parsed.data.expectedRevision || !provider)
                    throw new OidcDomainError('configuration_conflict')
                return provider
            })
        const provider = await read()
        const origin = dependencies.origin()
        if (!origin) throw new OidcDomainError('configuration_unavailable')
        // Discovery and JWKS are public documents. Never decrypt or send the stored credential.
        await dependencies.verify({
            providerId: provider.id,
            revision: provider.revision,
            issuer: provider.issuer,
            clientId: provider.clientId,
            clientSecret: '',
            tokenEndpointAuthMethod: provider.tokenEndpointAuthMethod,
            allowedEndpointOrigins: provider.allowedEndpointOrigins,
            allowedPrivateCidrs: provider.allowedPrivateCidrs,
        })
        const current = await read()
        if (JSON.stringify(current) !== JSON.stringify(provider))
            throw new OidcDomainError('configuration_conflict')
        if (dependencies.origin() !== origin) throw new OidcDomainError('configuration_conflict')
        return {
            status: 'metadata_verified',
            callbackUrl: new URL(OIDC_CALLBACK_PATH, origin).href,
        }
    }
}

export const testOidcProviderService = createOidcProviderTestService({
    session: requireSessionService,
    transaction: (run) => getAuthDatabase().transaction(run),
    authorize: authorizeOidcOwnerInTransaction,
    lock: lockStoredOidcSettings,
    limit: async (identifier) => {
        await consumeRateLimit({ ...OIDC_CONFIGURATION_RATE_LIMIT, identifier })
    },
    origin: getPublicOrigin,
    verify: (configuration) => oidcProtocolClient.verifyMetadata(configuration),
})
