import type {
    EncryptedCrowdSecApiKey,
    StoredCrowdSecConfiguration,
} from './Types/crowdsec-settings.types.ts'
import { storedCrowdSecConfigurationSchema } from './crowdsec-settings.validation.ts'
// oxlint-disable-next-line import/no-unassigned-import -- Keeps encrypted CrowdSec settings behind the server boundary.
import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'

import { CROWDSEC_SECRET_CONTEXT, CROWDSEC_SETTINGS_KEY } from '@/config/crowdsec.config.ts'
import { systemSettings } from '@/db/schema.ts'
import { crowdSecApiUrlSchema } from '@/features/Admin/CrowdSec/validation.ts'
import type { UpdateCrowdSecConfigurationInput } from '@/features/Admin/CrowdSec/Types/validation.types.ts'
import type { CrowdSecControllerRequest } from '@/server/Controller/Types/crowdsec.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import {
    decodeBase64Url,
    decryptSecret,
    encryptSecret,
} from '@/server/Auth/Core/encryption.server.ts'
import { CrowdSecDomainError } from './crowdsec.errors.ts'

export const DEFAULT_CROWDSEC_CONFIGURATION: StoredCrowdSecConfiguration = {
    version: 1,
    mode: 'disabled',
    communityEnabled: false,
}

function parseStored(input: unknown): StoredCrowdSecConfiguration {
    let value = input
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value)
        } catch {
            throw new CrowdSecDomainError('configuration_unavailable')
        }
    }
    const parsed = storedCrowdSecConfigurationSchema.safeParse(value)
    if (!parsed.success) throw new CrowdSecDomainError('configuration_unavailable')
    return parsed.data
}

export function normalizeCrowdSecApiUrl(value: string): string {
    const parsed = crowdSecApiUrlSchema.safeParse(value)
    if (!parsed.success) throw new CrowdSecDomainError('invalid_input')
    const url = new URL(parsed.data)
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    return url.toString()
}

export async function readStoredCrowdSecConfiguration(
    transaction: AuthTransaction,
): Promise<StoredCrowdSecConfiguration> {
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, CROWDSEC_SETTINGS_KEY))
        .limit(1)
    return row ? parseStored(row.value) : DEFAULT_CROWDSEC_CONFIGURATION
}

export async function lockStoredCrowdSecConfiguration(
    transaction: AuthTransaction,
): Promise<StoredCrowdSecConfiguration> {
    await transaction
        .insert(systemSettings)
        .values({
            key: CROWDSEC_SETTINGS_KEY,
            value: sql`${DEFAULT_CROWDSEC_CONFIGURATION}`,
        })
        .onConflictDoNothing({ target: systemSettings.key })
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, CROWDSEC_SETTINGS_KEY))
        .limit(1)
        .for('update')
    if (!row) throw new CrowdSecDomainError('configuration_unavailable')
    return parseStored(row.value)
}

export async function writeStoredCrowdSecConfiguration(
    transaction: AuthTransaction,
    value: StoredCrowdSecConfiguration,
): Promise<void> {
    const parsed = storedCrowdSecConfigurationSchema.safeParse(value)
    if (!parsed.success) throw new CrowdSecDomainError('invalid_input')
    await transaction
        .update(systemSettings)
        .set({ value: sql`${parsed.data}`, updatedAt: new Date() })
        .where(eq(systemSettings.key, CROWDSEC_SETTINGS_KEY))
}

async function encodeApiKey(apiKey: string) {
    const encrypted = await encryptSecret(apiKey, CROWDSEC_SECRET_CONTEXT)
    return {
        ciphertext: Buffer.from(encrypted.ciphertext).toString('base64url'),
        iv: Buffer.from(encrypted.iv).toString('base64url'),
    }
}

async function decodeApiKey(value: EncryptedCrowdSecApiKey): Promise<string> {
    const ciphertext = decodeBase64Url(value.ciphertext)
    const iv = decodeBase64Url(value.iv)
    if (!ciphertext || !iv) throw new CrowdSecDomainError('configuration_unavailable')
    try {
        return await decryptSecret({ ciphertext, iv }, CROWDSEC_SECRET_CONTEXT)
    } catch {
        throw new CrowdSecDomainError('configuration_unavailable')
    }
}

export async function buildStoredCrowdSecConfiguration(
    current: StoredCrowdSecConfiguration,
    input: UpdateCrowdSecConfigurationInput,
): Promise<StoredCrowdSecConfiguration> {
    if (input.mode !== 'external')
        return {
            ...current,
            mode: input.mode,
            communityEnabled:
                input.mode === 'managed'
                    ? (input.communityEnabled ?? false)
                    : (current.communityEnabled ?? false),
        }
    const apiUrl = normalizeCrowdSecApiUrl(input.apiUrl ?? '')
    // A write-only saved credential must never be forwarded to a newly selected endpoint.
    const apiKey = input.apiKey
        ? await encodeApiKey(input.apiKey)
        : current.external?.apiUrl === apiUrl
          ? current.external.apiKey
          : undefined
    if (!apiKey) throw new CrowdSecDomainError('api_key_required')
    return {
        version: 1,
        mode: 'external',
        communityEnabled: current.communityEnabled ?? false,
        external: { apiUrl, apiKey },
    }
}

export async function crowdSecControllerRequestFromStored(
    stored: StoredCrowdSecConfiguration,
): Promise<CrowdSecControllerRequest> {
    if (stored.mode === 'disabled') return { mode: 'disabled' }
    if (stored.mode === 'managed')
        return { mode: 'managed', communityEnabled: stored.communityEnabled ?? false }
    if (!stored.external) throw new CrowdSecDomainError('configuration_unavailable')
    return {
        mode: 'external',
        apiUrl: stored.external.apiUrl,
        apiKey: await decodeApiKey(stored.external.apiKey),
    }
}

export async function externalApiKeyFromStored(
    stored: StoredCrowdSecConfiguration,
): Promise<string> {
    if (!stored.external) throw new CrowdSecDomainError('api_key_required')
    return decodeApiKey(stored.external.apiKey)
}
