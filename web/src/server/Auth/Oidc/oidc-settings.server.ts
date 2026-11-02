import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { OIDC_LIMITS, OIDC_SECRET_CONTEXT, OIDC_SETTINGS_KEY } from '@/config/oidc.config.ts'
import { systemSettings } from '@/db/schema.ts'
import { oidcProviderSchema, saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'
import type {
    OidcProvidersSummary,
    SaveOidcProvidersInput,
} from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import {
    decodeBase64Url,
    decryptSecret,
    encryptSecret,
} from '@/server/Auth/Core/encryption.server.ts'
import { parseWebhookDestination } from '@/server/Notifications/webhook-policy.ts'
import { OidcDomainError } from './oidc.errors.ts'
import type { StoredOidcProvider, StoredOidcSettings } from './Types/oidc-provider.types.ts'

export const DEFAULT_OIDC_SETTINGS: StoredOidcSettings = { version: 1, revision: 0, providers: [] }
const storedSchema = z
    .object({
        version: z.literal(1),
        revision: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
        providers: z
            .array(
                oidcProviderSchema.safeExtend({
                    revision: z
                        .number()
                        .int()
                        .positive()
                        .max(Number.MAX_SAFE_INTEGER - 1),
                    clientSecret: z
                        .object({
                            ciphertext: z
                                .string()
                                .min(23)
                                .max(4_096)
                                .regex(/^[A-Za-z0-9_-]+$/u),
                            iv: z
                                .string()
                                .length(16)
                                .regex(/^[A-Za-z0-9_-]+$/u),
                        })
                        .strict(),
                }),
            )
            .max(OIDC_LIMITS.providers),
    })
    .strict()

/** Applies the same explicit destination policy to newly submitted and persisted trust settings. */
function validateDestinations(
    provider: StoredOidcProvider | SaveOidcProvidersInput['providers'][number],
): void {
    for (const url of [provider.issuer, ...provider.allowedEndpointOrigins]) {
        try {
            parseWebhookDestination({
                kind: 'webhook',
                url,
                allowedPrivateCidrs: provider.allowedPrivateCidrs,
                authorizationToken: null,
            })
        } catch {
            throw new OidcDomainError('invalid_input')
        }
    }
}

/** Rejects corrupt persisted trust settings rather than enabling a partially validated provider. */
export function parseStoredOidcSettings(input: unknown): StoredOidcSettings {
    try {
        const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
        const parsed = storedSchema.parse(value)
        saveOidcProvidersSchema.parse({
            expectedRevision: parsed.revision,
            providers: parsed.providers.map(
                ({ revision: _revision, clientSecret: _secret, ...provider }) => provider,
            ),
        })
        for (const provider of parsed.providers) {
            if (provider.revision > parsed.revision) throw new Error('revision')
            validateDestinations(provider)
            const iv = decodeBase64Url(provider.clientSecret.iv)
            const ciphertext = decodeBase64Url(provider.clientSecret.ciphertext)
            if (iv?.byteLength !== 12 || !ciphertext || ciphertext.byteLength < 17)
                throw new Error('credential')
        }
        return parsed
    } catch {
        throw new OidcDomainError('configuration_unavailable')
    }
}

/** Reads the JSONB trust document without decrypting credentials or creating storage rows. */
export async function readStoredOidcSettings(
    transaction: AuthTransaction,
): Promise<StoredOidcSettings> {
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, OIDC_SETTINGS_KEY))
        .limit(1)
    return row ? parseStoredOidcSettings(row.value) : DEFAULT_OIDC_SETTINGS
}

/** Serializes trust mutations and login finalization through one durable settings-row lock. */
export async function lockStoredOidcSettings(
    transaction: AuthTransaction,
): Promise<StoredOidcSettings> {
    await transaction
        .insert(systemSettings)
        .values({ key: OIDC_SETTINGS_KEY, value: sql`${DEFAULT_OIDC_SETTINGS}` })
        .onConflictDoNothing({ target: systemSettings.key })
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, OIDC_SETTINGS_KEY))
        .limit(1)
        .for('update')
    if (!row) throw new OidcDomainError('configuration_unavailable')
    return parseStoredOidcSettings(row.value)
}

/** Persists a validated JSON object within the caller's locked transaction. */
export async function writeStoredOidcSettings(
    transaction: AuthTransaction,
    value: StoredOidcSettings,
): Promise<void> {
    const parsed = parseStoredOidcSettings(value)
    await transaction
        .update(systemSettings)
        .set({ value: sql`${parsed}`, updatedAt: new Date() })
        .where(eq(systemSettings.key, OIDC_SETTINGS_KEY))
}

/** Binds encryption to the provider identity and exact configured credential destinations. */
export function oidcSecretContext(
    provider: Pick<
        StoredOidcProvider,
        | 'id'
        | 'issuer'
        | 'clientId'
        | 'tokenEndpointAuthMethod'
        | 'allowedEndpointOrigins'
        | 'allowedPrivateCidrs'
    >,
): string {
    const trust = JSON.stringify([
        provider.issuer,
        provider.clientId,
        provider.tokenEndpointAuthMethod,
        provider.allowedEndpointOrigins.toSorted(),
        provider.allowedPrivateCidrs.toSorted(),
    ])
    return `${OIDC_SECRET_CONTEXT}${provider.id}:${createHash('sha256').update(trust).digest('hex')}`
}

/** Applies a revision-checked replacement, retaining credentials only for an unchanged trust context. */
export async function buildStoredOidcSettings(
    current: StoredOidcSettings,
    input: SaveOidcProvidersInput,
): Promise<StoredOidcSettings> {
    const parsed = saveOidcProvidersSchema.safeParse(input)
    if (!parsed.success) throw new OidcDomainError('invalid_input')
    if (current.revision !== parsed.data.expectedRevision)
        throw new OidcDomainError('configuration_conflict')
    const revision = current.revision + 1
    if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER)
        throw new OidcDomainError('configuration_unavailable')
    const providers = await Promise.all(
        parsed.data.providers.map(async ({ clientSecret, ...provider }) => {
            validateDestinations(provider)
            const previous = current.providers.find((saved) => saved.id === provider.id)
            const context = oidcSecretContext(provider)
            let encrypted =
                previous && oidcSecretContext(previous) === context
                    ? previous.clientSecret
                    : undefined
            if (clientSecret) {
                const secret = await encryptSecret(clientSecret, context)
                encrypted = {
                    ciphertext: Buffer.from(secret.ciphertext).toString('base64url'),
                    iv: Buffer.from(secret.iv).toString('base64url'),
                }
            }
            if (!encrypted) throw new OidcDomainError('invalid_input')
            return Object.assign(provider, { revision, clientSecret: encrypted })
        }),
    )
    return { version: 1, revision, providers }
}

/** Removes encrypted credentials from the owner's configuration response. */
export function summarizeOidcSettings(settings: StoredOidcSettings): OidcProvidersSummary {
    return {
        revision: settings.revision,
        providers: settings.providers.map(({ clientSecret: _secret, ...provider }) => ({
            ...provider,
            credentialConfigured: true,
        })),
    }
}

/** Opens a provider credential only within its authenticated trust context. */
export async function decryptOidcClientSecret(provider: StoredOidcProvider): Promise<string> {
    const ciphertext = decodeBase64Url(provider.clientSecret.ciphertext)
    const iv = decodeBase64Url(provider.clientSecret.iv)
    if (!ciphertext || !iv) throw new OidcDomainError('configuration_unavailable')
    try {
        return await decryptSecret({ ciphertext, iv }, oidcSecretContext(provider))
    } catch {
        throw new OidcDomainError('configuration_unavailable')
    }
}
