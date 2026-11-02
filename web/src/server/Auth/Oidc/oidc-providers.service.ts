import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { OIDC_CONFIGURATION_RATE_LIMIT } from '@/config/oidc.config.ts'
import type { SaveOidcProvidersInput } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import { saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'
import { requireSessionService } from '@/server/Auth/Access/authorization.service.ts'
import {
    hasOwnerRole,
    resolveActiveUserAccessInTransaction,
} from '@/server/Auth/Access/rbac.service.ts'
import {
    lockActiveUserForAuthenticationInTransaction,
    requireRecentSessionInTransaction,
} from '@/server/Auth/Access/sessions.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { OidcDomainError } from './oidc.errors.ts'
import {
    buildStoredOidcSettings,
    decryptOidcClientSecret,
    lockStoredOidcSettings,
    readStoredOidcSettings,
    summarizeOidcSettings,
    writeStoredOidcSettings,
} from './oidc-settings.server.ts'
import type { OidcProviderDependencies, StoredOidcProvider } from './Types/oidc-provider.types.ts'
import type { OidcClientConfiguration } from './Types/oidc.types.ts'
import {
    lockOidcAccountPolicyInTransaction,
    validateOidcAccountPoliciesInTransaction,
} from './oidc-accounts.service.ts'

/** Rechecks local owner access and recent authentication under the active-user lock. */
export async function authorizeOidcOwnerInTransaction(
    transaction: AuthTransaction,
    session: Awaited<ReturnType<typeof requireSessionService>>,
): Promise<void> {
    await lockActiveUserForAuthenticationInTransaction(transaction, session.user.id)
    const user = await resolveActiveUserAccessInTransaction(transaction, session.user.id)
    if (!user || !user.permissions.includes(PERMISSIONS.APP_ACCESS))
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    if (!hasOwnerRole(user.roles)) throw new AuthDomainError('owner_required', 'Owner is required.')
    await requireRecentSessionInTransaction(transaction, session)
}

/** Separates owner-authorized trust mutations from the credential-free public sign-in catalog. */
export function createOidcProvidersService(dependencies: OidcProviderDependencies) {
    return {
        /** Exposes only names and IDs of enabled providers with an explicitly linked account. */
        async getPublicOidcProvidersService(): Promise<Array<{ id: string; name: string }>> {
            return dependencies.transaction(async (transaction) => {
                const settings = await dependencies.read(transaction)
                return settings.providers
                    .filter(
                        (provider) =>
                            provider.enabled &&
                            (provider.bindings.length > 0 ||
                                provider.accountPolicy?.provisioning === true) &&
                            !!provider.clientSecret,
                    )
                    .map(({ id, name }) => ({ id, name }))
            })
        },
        /** Rechecks the owner session before returning a credential-free configuration snapshot. */
        async getOidcProvidersService() {
            const session = await dependencies.session()
            if (!hasOwnerRole(session.user.roles))
                throw new AuthDomainError('owner_required', 'Owner is required.')
            return dependencies.transaction(async (transaction) => {
                const current = await dependencies.read(transaction)
                await dependencies.authorize(transaction, session)
                return summarizeOidcSettings(current)
            })
        },
        /** Serializes revision-checked owner changes, validates new bindings and audits the committed policy. */
        async saveOidcProvidersService(input: SaveOidcProvidersInput) {
            const session = await dependencies.session()
            if (!hasOwnerRole(session.user.roles))
                throw new AuthDomainError('owner_required', 'Owner is required.')
            const parsed = saveOidcProvidersSchema.safeParse(input)
            if (!parsed.success) throw new OidcDomainError('invalid_input')
            await dependencies.limit(session.user.id)
            const summary = await dependencies.transaction(async (transaction) => {
                // All OIDC paths lock singleton configuration before any user/session locks.
                const current = await dependencies.lock(transaction)
                await dependencies.authorize(transaction, session)
                if (current.revision !== parsed.data.expectedRevision)
                    throw new OidcDomainError('configuration_conflict')
                const targetIds = [
                    ...new Set(
                        parsed.data.providers.flatMap((provider) => {
                            const previous = current.providers.find(
                                (saved) =>
                                    saved.id === provider.id && saved.issuer === provider.issuer,
                            )
                            // Retained links may outlive their target's access. Owners must still
                            // be able to disable or rotate a provider without reviving that user.
                            return provider.bindings
                                .filter(
                                    (binding) =>
                                        !previous?.bindings.some(
                                            (saved) =>
                                                saved.subject === binding.subject &&
                                                saved.userId === binding.userId,
                                        ),
                                )
                                .map((binding) => binding.userId)
                        }),
                    ),
                ].toSorted()
                for (const userId of targetIds) {
                    // oxlint-disable-next-line no-await-in-loop -- Acquire user locks in a deterministic order.
                    await dependencies.validateUser(transaction, userId)
                }
                const settings = await dependencies.build(current, parsed.data)
                await dependencies.write(transaction, settings)
                await dependencies.audit(transaction, session.user.id)
                return summarizeOidcSettings(settings)
            })
            dependencies.publish()
            return summary
        },
    }
}

export const { getOidcProvidersService, saveOidcProvidersService, getPublicOidcProvidersService } =
    createOidcProvidersService({
        session: requireSessionService,
        transaction: (run) => getAuthDatabase().transaction(run),
        authorize: authorizeOidcOwnerInTransaction,
        validateUser: async (transaction, userId) => {
            await lockActiveUserForAuthenticationInTransaction(transaction, userId)
            const user = await resolveActiveUserAccessInTransaction(transaction, userId)
            if (!user || !user.permissions.includes(PERMISSIONS.APP_ACCESS))
                throw new OidcDomainError('identity_not_allowed')
        },
        read: readStoredOidcSettings,
        lock: async (transaction) => {
            await lockOidcAccountPolicyInTransaction(transaction)
            return lockStoredOidcSettings(transaction)
        },
        write: async (transaction, settings) => {
            await validateOidcAccountPoliciesInTransaction(transaction, settings.providers)
            await writeStoredOidcSettings(transaction, settings)
        },
        build: buildStoredOidcSettings,
        limit: async (identifier) => {
            await consumeRateLimit({ ...OIDC_CONFIGURATION_RATE_LIMIT, identifier })
        },
        audit: (transaction, actorId) =>
            appendAuditEventInTransactionService(transaction, {
                actorUserId: actorId,
                actorKind: 'user',
                action: 'update',
                resource: 'security-settings',
                targetId: null,
                result: 'success',
                metadata: { changedFields: ['oidcProviders'] },
            }),
        publish: publishApplicationChange,
    })

/** Uses the same settings-row lock as provider mutations before a caller locks its authenticating user. */
export async function lockOidcProviderInTransaction(
    transaction: AuthTransaction,
    providerId: string,
): Promise<StoredOidcProvider | null> {
    const settings = await lockStoredOidcSettings(transaction)
    return settings.providers.find((provider) => provider.id === providerId) ?? null
}

/** Reads internal provider policy without opening its encrypted credential. */
export async function readOidcProviderService(
    providerId: string,
): Promise<StoredOidcProvider | null> {
    return getAuthDatabase().transaction(async (transaction) => {
        const settings = await readStoredOidcSettings(transaction)
        return settings.providers.find((provider) => provider.id === providerId) ?? null
    })
}

/** Opens credentials for an enabled provider only, retaining its revision and explicit endpoint trust. */
export async function getOidcClientConfigurationService(
    providerId: string,
): Promise<OidcClientConfiguration> {
    const provider = await readOidcProviderService(providerId)
    if (!provider?.enabled) throw new OidcDomainError('provider_unavailable')
    return {
        providerId: provider.id,
        revision: provider.revision,
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: await decryptOidcClientSecret(provider),
        tokenEndpointAuthMethod: provider.tokenEndpointAuthMethod,
        allowedEndpointOrigins: provider.allowedEndpointOrigins,
        allowedPrivateCidrs: provider.allowedPrivateCidrs,
        ...(provider.accountPolicy ? { groupClaim: provider.accountPolicy.groupClaim } : {}),
    }
}
