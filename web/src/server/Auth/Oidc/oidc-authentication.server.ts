import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { lockActiveUserForAuthenticationInTransaction } from '@/server/Auth/Access/sessions.service.ts'
import { resolveActiveUserAccessInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { OidcIdentityProof } from './Types/oidc.types.ts'
import { lockOidcProviderInTransaction } from './oidc-providers.service.ts'

/** Rechecks external trust under the provider lock before locking and authorizing the local user. */
export async function requireOidcAuthenticationInTransaction(
    transaction: AuthTransaction,
    proof: OidcIdentityProof,
): Promise<void> {
    const provider = await lockOidcProviderInTransaction(transaction, proof.providerId)
    if (
        !provider?.enabled ||
        provider.revision !== proof.providerRevision ||
        provider.issuer !== proof.issuer ||
        !provider.bindings.some(
            (binding) => binding.subject === proof.subject && binding.userId === proof.userId,
        )
    ) {
        throw new AuthDomainError('user_not_active', 'Authentication state is no longer valid.')
    }

    await lockActiveUserForAuthenticationInTransaction(transaction, proof.userId)
    const access = await resolveActiveUserAccessInTransaction(transaction, proof.userId)
    if (!access?.permissions.includes(PERMISSIONS.APP_ACCESS)) {
        throw new AuthDomainError('user_not_active', 'User is not active.')
    }
}
