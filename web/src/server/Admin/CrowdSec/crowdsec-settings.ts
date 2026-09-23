// oxlint-disable-next-line import/no-unassigned-import -- Keeps encrypted CrowdSec settings behind the server boundary.
import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { CROWDSEC_SECRET_CONTEXT, CROWDSEC_SETTINGS_KEY } from '../../../config/crowdsec.config'
import { systemSettings } from '../../../db/schema'
import {
    crowdSecApiUrlSchema,
    crowdSecModeSchema,
    type UpdateCrowdSecConfigurationInput,
} from '../../../features/Admin/CrowdSec/validation'
import type { CrowdSecControllerRequest } from '../../Foundation/controller.server'
import type { AuthTransaction } from '../../Auth/Core/database.server'
import {
    decodeBase64Url,
    decryptSecret,
    encodeBase64Url,
    encryptSecret,
} from '../../Auth/Core/encryption.server'
import { CrowdSecDomainError } from './crowdsec.errors'

const encryptedApiKeySchema = z.strictObject({
    ciphertext: z.string().min(1).max(1_024),
    iv: z.string().min(1).max(64),
})
const externalConfigurationSchema = z.strictObject({
    apiUrl: crowdSecApiUrlSchema,
    apiKey: encryptedApiKeySchema,
})
const storedCrowdSecConfigurationSchema = z
    .strictObject({
        version: z.literal(1),
        mode: crowdSecModeSchema,
        communityEnabled: z.boolean().optional(),
        external: externalConfigurationSchema.optional(),
    })
    .superRefine((value, context) => {
        if (value.mode === 'external' && value.external === undefined) {
            context.addIssue({ code: 'custom', path: ['external'], message: 'required' })
        }
    })

export type StoredCrowdSecConfiguration = z.infer<typeof storedCrowdSecConfigurationSchema>

export const DEFAULT_CROWDSEC_CONFIGURATION: StoredCrowdSecConfiguration = {
    version: 1,
    mode: 'disabled',
    communityEnabled: false,
}

function jsonbValue(value: unknown) {
    return sql`${value}`
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

export function crowdSecConfigurationFingerprint(value: StoredCrowdSecConfiguration): string {
    return JSON.stringify(value)
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
            value: jsonbValue(DEFAULT_CROWDSEC_CONFIGURATION),
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
        .set({ value: jsonbValue(parsed.data), updatedAt: new Date() })
        .where(eq(systemSettings.key, CROWDSEC_SETTINGS_KEY))
}

async function encodeApiKey(apiKey: string) {
    const encrypted = await encryptSecret(apiKey, CROWDSEC_SECRET_CONTEXT)
    return {
        ciphertext: encodeBase64Url(encrypted.ciphertext),
        iv: encodeBase64Url(encrypted.iv),
    }
}

async function decodeApiKey(value: z.infer<typeof encryptedApiKeySchema>): Promise<string> {
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
