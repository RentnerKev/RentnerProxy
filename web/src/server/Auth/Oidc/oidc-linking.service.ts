import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import { ACTIVE_OWNER_ADVISORY_LOCK_ID } from '@/config/auth.config.ts'
import { OIDC_CONFIGURATION_RATE_LIMIT, OIDC_LIMITS } from '@/config/oidc.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { passkeys, users } from '@/db/schema.ts'
import { requireSessionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import {
    lockActiveUserForAuthenticationInTransaction,
    requireRecentSessionInTransaction,
} from '@/server/Auth/Access/sessions.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { CurrentSession } from '@/server/Auth/Core/Types/auth-service.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import {
    lockStoredOidcSettings,
    readStoredOidcSettings,
    writeStoredOidcSettings,
} from './oidc-settings.server.ts'
import { OidcDomainError } from './oidc.errors.ts'
import type { OidcLinkTarget } from './Types/oidc-flow.types.ts'
import type { OidcClientConfiguration, OidcVerifiedIdentity } from './Types/oidc.types.ts'
import type { StoredOidcSettings } from './Types/oidc-provider.types.ts'

/** Uses the same global order as account provisioning and manual role changes. */
async function lockLinkSettings(transaction: AuthTransaction) {
    await transaction.execute(sql`select pg_advisory_xact_lock(${ACTIVE_OWNER_ADVISORY_LOCK_ID})`)
    return lockStoredOidcSettings(transaction)
}

/** Self-service linking never turns an externally managed account into a local account. */
async function requireIndependentLocalAccount(
    transaction: AuthTransaction,
    session: CurrentSession,
) {
    await lockActiveUserForAuthenticationInTransaction(transaction, session.user.id)
    await requirePermissionInTransaction(transaction, session.user.id, PERMISSIONS.ACCOUNT_UPDATE)
    const [user] = await transaction
        .select({ passwordHash: users.passwordHash, oidcProviderId: users.oidcProviderId })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1)
    const [passkey] = await transaction
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(eq(passkeys.userId, session.user.id))
        .limit(1)
    if (!user || user.oidcProviderId || (!user.passwordHash && !passkey))
        throw new OidcDomainError('identity_not_allowed')
    await requireRecentSessionInTransaction(transaction, session)
}

/** Changes document revision for stale owner drafts; individual bindings retain their own generation. */
async function commitLinkSettings(
    transaction: AuthTransaction,
    settings: StoredOidcSettings,
    actorId: string,
) {
    const revision = settings.revision + 1
    if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER)
        throw new OidcDomainError('configuration_unavailable')
    await writeStoredOidcSettings(transaction, { ...settings, revision })
    await appendAuditEventInTransactionService(transaction, {
        actorUserId: actorId,
        actorKind: 'user',
        action: 'update',
        resource: 'security-settings',
        targetId: actorId,
        result: 'success',
        metadata: { changedFields: ['oidcProviders'] },
    })
}

/** Checks fresh local consent before a browser-bound authorization flow is issued. */
export async function authorizeOidcLinkService(providerId: string): Promise<OidcLinkTarget> {
    const session = await requireSessionService()
    await consumeRateLimit({ ...OIDC_CONFIGURATION_RATE_LIMIT, identifier: session.user.id })
    const expectedRevision = await getAuthDatabase().transaction(async (transaction) => {
        const settings = await lockLinkSettings(transaction)
        if (!settings.providers.some((provider) => provider.id === providerId && provider.enabled))
            throw new OidcDomainError('provider_unavailable')
        await requireIndependentLocalAccount(transaction, session)
        return settings.revision
    })
    return { userId: session.user.id, sessionId: session.id, expectedRevision }
}

/** Binds a verified issuer/subject only to the same still-authenticated local browser session. */
export async function completeOidcLinkService(
    configuration: OidcClientConfiguration,
    identity: OidcVerifiedIdentity,
    target: OidcLinkTarget,
): Promise<void> {
    const session = await requireSessionService()
    if (session.user.id !== target.userId || session.id !== target.sessionId)
        throw new AuthDomainError('authentication_required', 'Authentication is required.')
    await getAuthDatabase().transaction(async (transaction) => {
        const settings = await lockLinkSettings(transaction)
        if (settings.revision !== target.expectedRevision)
            throw new OidcDomainError('configuration_conflict')
        const provider = settings.providers.find((entry) => entry.id === configuration.providerId)
        if (
            !provider?.enabled ||
            provider.revision !== configuration.revision ||
            provider.issuer !== configuration.issuer ||
            identity.issuer !== provider.issuer ||
            !Number.isSafeInteger(identity.expiresAt) ||
            identity.expiresAt <= Date.now()
        )
            throw new OidcDomainError('identity_not_allowed')
        await requireIndependentLocalAccount(transaction, session)
        const existing = settings.providers
            .flatMap((entry) => entry.bindings.map((binding) => ({ provider: entry, binding })))
            .find(
                (entry) =>
                    entry.provider.issuer === identity.issuer &&
                    entry.binding.subject === identity.subject,
            )
        if (existing) {
            if (existing.provider.id === provider.id && existing.binding.userId === session.user.id)
                return
            throw new OidcDomainError('identity_not_allowed')
        }
        if (provider.bindings.length >= OIDC_LIMITS.bindings)
            throw new OidcDomainError('identity_not_allowed')
        const updated = {
            ...settings,
            providers: settings.providers.map((entry) =>
                entry.id === provider.id
                    ? Object.assign({}, entry, {
                          bindings: [
                              ...entry.bindings,
                              {
                                  subject: identity.subject,
                                  userId: session.user.id,
                                  generation: settings.revision + 1,
                              },
                          ],
                      })
                    : entry,
            ),
        }
        await commitLinkSettings(transaction, updated, session.user.id)
    })
    publishApplicationChange()
}

/** Lists only the current user's connection state and public provider names. */
export async function getOidcConnectionsService() {
    const session = await requireSessionService()
    return getAuthDatabase().transaction(async (transaction) => {
        await requirePermissionInTransaction(
            transaction,
            session.user.id,
            PERMISSIONS.ACCOUNT_UPDATE,
        )
        const settings = await readStoredOidcSettings(transaction)
        const [user] = await transaction
            .select({ oidcProviderId: users.oidcProviderId })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1)
        return {
            revision: settings.revision,
            externallyManaged: !!user?.oidcProviderId,
            providers: settings.providers
                .filter(
                    (provider) =>
                        provider.enabled ||
                        provider.bindings.some((binding) => binding.userId === session.user.id),
                )
                .map((provider) => ({
                    id: provider.id,
                    name: provider.name,
                    enabled: provider.enabled,
                    linked: provider.bindings.some((binding) => binding.userId === session.user.id),
                })),
        }
    })
}

/** Unlinks only the current account, preserving an independent local login and invalidating stale provider proof. */
export async function unlinkOidcConnectionService(input: {
    providerId: string
    expectedRevision: number
}) {
    const session = await requireSessionService()
    await consumeRateLimit({ ...OIDC_CONFIGURATION_RATE_LIMIT, identifier: session.user.id })
    await getAuthDatabase().transaction(async (transaction) => {
        const settings = await lockLinkSettings(transaction)
        await requireIndependentLocalAccount(transaction, session)
        if (settings.revision !== input.expectedRevision)
            throw new OidcDomainError('configuration_conflict')
        const provider = settings.providers.find((entry) => entry.id === input.providerId)
        if (!provider?.bindings.some((binding) => binding.userId === session.user.id))
            throw new OidcDomainError('identity_not_allowed')
        const updated = {
            ...settings,
            providers: settings.providers.map((entry) =>
                entry.id === provider.id
                    ? Object.assign({}, entry, {
                          bindings: entry.bindings.filter(
                              (binding) => binding.userId !== session.user.id,
                          ),
                      })
                    : entry,
            ),
        }
        await commitLinkSettings(transaction, updated, session.user.id)
    })
    publishApplicationChange()
}
