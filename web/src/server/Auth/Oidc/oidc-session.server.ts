import '@tanstack/react-start/server-only'

import { z } from 'zod'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import type { OidcSessionProof } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import { SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { readStoredOidcSettings } from './oidc-settings.server.ts'

const proofSchema = z.object({
    providerId: z.uuid(),
    providerRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    bindingGeneration: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .default(0),
    issuer: z.string().min(1).max(OIDC_LIMITS.urlLength),
    subject: z.string().regex(/^[\x21-\x7e]{1,255}$/u),
    userId: z.uuid(),
    expiresAt: z.number().int().positive().max(8_640_000_000_000_000),
})

/** Retains only identity provenance and bounds sessions by the verified token and local policy. */
export function prepareOidcSessionProof(
    proof: unknown,
    userId: string,
    now = Date.now(),
): OidcSessionProof {
    const parsed = proofSchema.safeParse(proof)
    if (!parsed.success || parsed.data.userId !== userId || parsed.data.expiresAt <= now)
        throw new AuthDomainError('user_not_active', 'Authentication state is no longer valid.')
    return {
        ...parsed.data,
        expiresAt: Math.min(parsed.data.expiresAt, now + OIDC_LIMITS.sessionDurationMs),
    }
}

/** Re-evaluates durable external trust without synchronizing roles or contacting an identity provider. */
export async function isOidcSessionValidInTransaction(
    transaction: AuthTransaction,
    proof: unknown,
    userId: string,
    managedProviderId: string | null,
    roleKeys: readonly string[],
    now = Date.now(),
): Promise<boolean> {
    const parsed = proofSchema.safeParse(proof)
    if (
        !parsed.success ||
        parsed.data.userId !== userId ||
        parsed.data.expiresAt <= now ||
        (managedProviderId !== null && managedProviderId !== parsed.data.providerId)
    )
        return false
    const settings = await readStoredOidcSettings(transaction)
    const provider = settings.providers.find((entry) => entry.id === parsed.data.providerId)
    const binding = provider?.bindings.find(
        (entry) => entry.subject === parsed.data.subject && entry.userId === userId,
    )
    return !!(
        provider?.enabled &&
        provider.revision === parsed.data.providerRevision &&
        provider.issuer === parsed.data.issuer &&
        binding &&
        (binding.generation ?? 0) === parsed.data.bindingGeneration &&
        !(
            (binding.roleSource === 'provider' || managedProviderId !== null) &&
            roleKeys.includes(SYSTEM_ROLES.OWNER)
        )
    )
}
