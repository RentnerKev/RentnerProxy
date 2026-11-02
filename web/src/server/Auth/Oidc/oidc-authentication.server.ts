import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { lockActiveUserForAuthenticationInTransaction } from '@/server/Auth/Access/sessions.service.ts'
import { resolveActiveUserAccessInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { OidcIdentityProof } from './Types/oidc.types.ts'
import { lockOidcProviderInTransaction } from './oidc-providers.service.ts'
import {
    lockOidcAccountPolicyInTransaction,
    synchronizeOidcAccountInTransaction,
} from './oidc-accounts.service.ts'

/** Rechecks external trust under the provider lock before locking and authorizing the local user. */
export async function requireOidcAuthenticationInTransaction(
    transaction: AuthTransaction,
    proof: OidcIdentityProof,
): Promise<void> {
    await lockOidcAccountPolicyInTransaction(transaction)
    const provider = await lockOidcProviderInTransaction(transaction, proof.providerId)
    if (
        !provider?.enabled ||
        provider.revision !== proof.providerRevision ||
        provider.issuer !== proof.issuer ||
        !Number.isSafeInteger(proof.expiresAt) ||
        proof.expiresAt <= Date.now() ||
        !provider.bindings.some(
            (binding) =>
                binding.subject === proof.subject &&
                binding.userId === proof.userId &&
                (binding.generation ?? 0) === (proof.bindingGeneration ?? 0),
        )
    ) {
        throw new AuthDomainError('user_not_active', 'Authentication state is no longer valid.')
    }

    await lockActiveUserForAuthenticationInTransaction(transaction, proof.userId)
    await synchronizeOidcAccountInTransaction(transaction, provider, proof)
    const access = await resolveActiveUserAccessInTransaction(transaction, proof.userId)
    if (!access?.permissions.includes(PERMISSIONS.APP_ACCESS)) {
        throw new AuthDomainError('user_not_active', 'User is not active.')
    }
}
