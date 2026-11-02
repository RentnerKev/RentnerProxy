import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import type { OidcVerifiedIdentity } from './Types/oidc.types.ts'
import { OidcDomainError } from './oidc.errors.ts'

const groupsSchema = z
    .array(
        z
            .string()
            .min(1)
            .max(OIDC_LIMITS.groupLength)
            .refine(
                (value) =>
                    !Array.from(value).some(
                        (character) =>
                            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
                    ),
            ),
    )
    .max(OIDC_LIMITS.groups)

/** Projects only bounded claims from an already signature-, issuer- and audience-verified ID token. */
export function readVerifiedOidcClaims(
    claims: { iss: string; sub: string; exp: number; [key: string]: unknown },
    groupClaim = 'groups',
): OidcVerifiedIdentity {
    const groups = groupsSchema.safeParse(
        claims[groupClaim] === undefined ? [] : claims[groupClaim],
    )
    const expiresAt = Math.floor(claims.exp * 1_000)
    if (!groups.success || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
        throw new OidcDomainError('authentication_failed')
    const email = z.email().max(254).safeParse(claims.email)
    const displayName = z.string().trim().min(2).max(100).safeParse(claims.name)
    return {
        issuer: claims.iss,
        subject: claims.sub,
        expiresAt,
        groups: [...new Set(groups.data)],
        ...(email.success
            ? { email: email.data, emailVerified: claims.email_verified === true }
            : {}),
        ...(displayName.success ? { displayName: displayName.data } : {}),
    }
}
