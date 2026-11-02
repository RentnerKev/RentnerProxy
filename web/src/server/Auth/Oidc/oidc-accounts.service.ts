import '@tanstack/react-start/server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ACTIVE_OWNER_ADVISORY_LOCK_ID } from '@/config/auth.config.ts'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { permissions, rolePermissions, users, userSettings } from '@/db/schema.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { normalizeEmail } from '@/server/Auth/Core/identity.server.ts'
import {
    getUserRoleKeysInTransaction,
    hasOwnerRole,
    loadRolesByKeysInTransaction,
    replaceUserRolesInTransaction,
} from '@/server/Auth/Access/rbac.service.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { revokeAllUserSessionsInTransaction } from '@/server/Auth/Access/sessions.service.ts'
import type { OidcProviderConfiguration } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type {
    OidcClientConfiguration,
    OidcIdentityProof,
    OidcVerifiedIdentity,
} from './Types/oidc.types.ts'
import type { StoredOidcProvider, StoredOidcSettings } from './Types/oidc-provider.types.ts'
import { lockStoredOidcSettings, writeStoredOidcSettings } from './oidc-settings.server.ts'
import { OidcDomainError } from './oidc.errors.ts'

/** Must precede settings, user, role and session locks on every account-policy path. */
export async function lockOidcAccountPolicyInTransaction(
    transaction: AuthTransaction,
): Promise<void> {
    await transaction.execute(sql`select pg_advisory_xact_lock(${ACTIVE_OWNER_ADVISORY_LOCK_ID})`)
}

/** Maps exact signed claim values; absent groups revoke all mapping-derived grants. */
export function resolveOidcRoleKeys(
    provider: OidcProviderConfiguration,
    groups?: readonly string[],
): string[] {
    if (
        groups &&
        (groups.length > OIDC_LIMITS.groups ||
            groups.some(
                (group) =>
                    typeof group !== 'string' ||
                    group.length === 0 ||
                    group.length > OIDC_LIMITS.groupLength,
            ))
    )
        throw new OidcDomainError('identity_not_allowed')
    const policy = provider.accountPolicy
    const verified = new Set(groups ?? [])
    return [
        ...new Set([
            ...(policy?.defaultRoleKeys ?? []),
            ...(policy?.groupRoleMappings ?? [])
                .filter((mapping) => verified.has(mapping.group))
                .flatMap((mapping) => mapping.roleKeys),
        ]),
    ]
}

async function loadExternalRoles(
    transaction: AuthTransaction,
    keys: readonly string[],
    requireAccess: boolean,
) {
    const roles = await loadRolesByKeysInTransaction(transaction, keys)
    if (hasOwnerRole(roles.map((role) => role.key)))
        throw new OidcDomainError('identity_not_allowed')
    if (requireAccess) {
        const access = roles.length
            ? await transaction
                  .select({ key: permissions.key })
                  .from(rolePermissions)
                  .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
                  .where(
                      and(
                          inArray(
                              rolePermissions.roleId,
                              roles.map((role) => role.id),
                          ),
                          eq(permissions.key, PERMISSIONS.APP_ACCESS),
                      ),
                  )
                  .limit(1)
            : []
        if (access.length === 0) throw new OidcDomainError('identity_not_allowed')
    }
    return roles
}

/** Validates owner-submitted policy under the same lock used by provisioning and role edits. */
export async function validateOidcAccountPoliciesInTransaction(
    transaction: AuthTransaction,
    providers: readonly OidcProviderConfiguration[],
): Promise<void> {
    const managedUsers = new Set<string>()
    const allKeys = [
        ...new Set(
            providers.flatMap((provider) => [
                ...(provider.accountPolicy?.defaultRoleKeys ?? []),
                ...(provider.accountPolicy?.groupRoleMappings ?? []).flatMap(
                    (mapping) => mapping.roleKeys,
                ),
            ]),
        ),
    ]
    await loadExternalRoles(transaction, allKeys, false)
    for (const provider of providers) {
        for (const binding of provider.bindings) {
            // oxlint-disable-next-line no-await-in-loop -- Lock managed targets deterministically under the owner-policy lock.
            const [user] = await transaction
                .select({ providerId: users.oidcProviderId })
                .from(users)
                .where(eq(users.id, binding.userId))
                .limit(1)
                .for('update')
            if (!user?.providerId && binding.roleSource !== 'provider') continue
            if (
                binding.roleSource !== 'provider' ||
                !user ||
                user.providerId !== provider.id ||
                managedUsers.has(binding.userId)
            )
                throw new OidcDomainError('identity_not_allowed')
            managedUsers.add(binding.userId)
            // oxlint-disable-next-line no-await-in-loop -- Protect current owner roles before admitting provider management.
            const roles = await getUserRoleKeysInTransaction(transaction, binding.userId)
            if (!user || user.providerId !== provider.id || hasOwnerRole(roles))
                throw new OidcDomainError('identity_not_allowed')
        }
    }
}

/** Replaces grants only for accounts created exclusively for this provider. */
export async function synchronizeOidcAccountInTransaction(
    transaction: AuthTransaction,
    provider: StoredOidcProvider,
    proof: OidcIdentityProof,
): Promise<void> {
    const binding = provider.bindings.find(
        (entry) => entry.subject === proof.subject && entry.userId === proof.userId,
    )
    const [user] = await transaction
        .select({ providerId: users.oidcProviderId, status: users.status })
        .from(users)
        .where(eq(users.id, proof.userId))
        .limit(1)
        .for('update')
    if (binding?.roleSource !== 'provider') {
        if (user?.providerId) throw new OidcDomainError('identity_not_allowed')
        return
    }
    const previous = await getUserRoleKeysInTransaction(transaction, proof.userId)
    if (
        !user ||
        user.status !== 'active' ||
        user.providerId !== provider.id ||
        hasOwnerRole(previous)
    )
        throw new OidcDomainError('identity_not_allowed')
    const selected = await loadExternalRoles(
        transaction,
        resolveOidcRoleKeys(provider, proof.groups),
        false,
    )
    if (
        previous.toSorted().join('\0') ===
        selected
            .map((role) => role.key)
            .toSorted()
            .join('\0')
    )
        return
    await replaceUserRolesInTransaction(transaction, proof.userId, selected)
    await revokeAllUserSessionsInTransaction(transaction, proof.userId)
    await appendAuditEventInTransactionService(transaction, {
        actorUserId: null,
        actorKind: 'system',
        action: 'update',
        resource: 'user',
        targetId: proof.userId,
        result: 'success',
        metadata: { changedFields: ['roles'], count: selected.length },
    })
}

/** Resolves or provisions under the durable settings lock, never linking by email. */
export async function resolveOidcAccountInTransaction(
    transaction: AuthTransaction,
    configuration: OidcClientConfiguration,
    identity: OidcVerifiedIdentity,
): Promise<OidcIdentityProof> {
    await lockOidcAccountPolicyInTransaction(transaction)
    const settings = await lockStoredOidcSettings(transaction)
    const provider = settings.providers.find((entry) => entry.id === configuration.providerId)
    if (
        !provider?.enabled ||
        provider.revision !== configuration.revision ||
        provider.issuer !== identity.issuer ||
        !Number.isSafeInteger(identity.expiresAt) ||
        identity.expiresAt <= Date.now()
    )
        throw new OidcDomainError('identity_not_allowed')
    let binding = provider.bindings.find((entry) => entry.subject === identity.subject)
    if (!binding) {
        if (
            !provider.accountPolicy?.provisioning ||
            provider.bindings.length >= OIDC_LIMITS.bindings ||
            identity.emailVerified !== true ||
            !identity.email ||
            settings.providers.some(
                (entry) =>
                    entry.issuer === identity.issuer &&
                    entry.bindings.some((saved) => saved.subject === identity.subject),
            )
        )
            throw new OidcDomainError('identity_not_allowed')
        const email = normalizeEmail(identity.email)
        const [collision] = await transaction
            .select({ id: users.id })
            .from(users)
            .where(eq(sql<string>`lower(${users.email})`, email))
            .limit(1)
        if (collision) throw new OidcDomainError('identity_not_allowed')
        const selected = await loadExternalRoles(
            transaction,
            resolveOidcRoleKeys(provider, identity.groups),
            true,
        )
        const name = identity.displayName?.trim()
        const [created] = await transaction
            .insert(users)
            .values({
                email,
                displayName:
                    name && name.length >= 2 && name.length <= 100 ? name : email.slice(0, 100),
                emailVerifiedAt: new Date(),
                status: 'active',
                passwordHash: null,
                oidcProviderId: provider.id,
            })
            .returning({ id: users.id })
        if (!created) throw new OidcDomainError('identity_not_allowed')
        await transaction.insert(userSettings).values({ userId: created.id })
        await replaceUserRolesInTransaction(transaction, created.id, selected)
        const revision = settings.revision + 1
        binding = {
            subject: identity.subject,
            userId: created.id,
            roleSource: 'provider',
            generation: revision,
        }
        const updated: StoredOidcSettings = {
            ...settings,
            revision,
            providers: settings.providers.map((entry) =>
                entry.id === provider.id
                    ? Object.assign({}, entry, {
                          bindings: [...entry.bindings, binding!],
                      })
                    : entry,
            ),
        }
        await writeStoredOidcSettings(transaction, updated)
        await appendAuditEventInTransactionService(transaction, {
            actorUserId: null,
            actorKind: 'system',
            action: 'create',
            resource: 'user',
            targetId: created.id,
            result: 'success',
            metadata: { changedFields: ['roles'], count: selected.length },
        })
    }
    return {
        providerId: provider.id,
        providerRevision: provider.revision,
        bindingGeneration: binding.generation ?? 0,
        issuer: identity.issuer,
        subject: identity.subject,
        userId: binding.userId,
        expiresAt: identity.expiresAt,
        ...(identity.groups ? { groups: identity.groups } : {}),
    }
}
