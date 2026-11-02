import '@tanstack/react-start/server-only'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import {
    encryptSecret,
    decryptSecret,
    decodeBase64Url,
} from '@/server/Auth/Core/encryption.server.ts'
import {
    createOpaqueToken,
    hashOpaqueToken,
    isValidOpaqueToken,
} from '@/server/Auth/Core/tokens.server.ts'
import { getValkeyClient } from '@/server/Valkey/client.server.ts'
import { OidcDomainError } from './oidc.errors.ts'
import type { OidcFlowStore, OidcStateDependencies } from './Types/oidc-flow.types.ts'

const flowSchema = z.strictObject({
    providerId: z.uuid(),
    providerRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    issuer: z.string().max(OIDC_LIMITS.urlLength),
    redirectUri: z.string().max(OIDC_LIMITS.urlLength),
    nonce: z.string().refine(isValidOpaqueToken),
    codeVerifier: z.string().refine(isValidOpaqueToken),
})
const envelopeSchema = z.strictObject({
    version: z.literal(1),
    browserHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().int(),
    expiresAt: z.number().int(),
    ciphertext: z.string().max(OIDC_LIMITS.callbackBytes),
    iv: z.string().max(32),
})

function key(hash: string): string {
    return `rentnerproxy:oidc-flow:${hash}`
}

function context(hash: string): string {
    return `rentnerproxy:oidc:flow:${hash}`
}

/** Stores encrypted, browser-bound exchanges and consumes each state at most once. */
export function createOidcFlowStore(overrides: Partial<OidcStateDependencies> = {}): OidcFlowStore {
    const dependencies: OidcStateDependencies = {
        client: getValkeyClient,
        now: Date.now,
        seal: encryptSecret,
        open: decryptSecret,
        ...overrides,
    }
    async function send(command: string, args: string[]) {
        try {
            const client = dependencies.client()
            if (!client) throw new Error()
            return await client.send(command, args)
        } catch {
            throw new OidcDomainError('configuration_unavailable')
        }
    }
    return {
        async issue(flow) {
            const parsed = flowSchema.safeParse(flow)
            if (!parsed.success) throw new OidcDomainError('invalid_input')
            const state = createOpaqueToken()
            const browserToken = createOpaqueToken()
            const hash = await hashOpaqueToken(state)
            const now = dependencies.now()
            const encrypted = await dependencies.seal(JSON.stringify(parsed.data), context(hash))
            const expiresAt = now + OIDC_LIMITS.flowDurationMs
            const value = JSON.stringify({
                version: 1,
                browserHash: await hashOpaqueToken(browserToken),
                createdAt: now,
                expiresAt,
                ciphertext: Buffer.from(encrypted.ciphertext).toString('base64url'),
                iv: Buffer.from(encrypted.iv).toString('base64url'),
            })
            const result = await send('SET', [
                key(hash),
                value,
                'NX',
                'PX',
                String(OIDC_LIMITS.flowDurationMs),
            ])
            if (result !== 'OK' && result !== true)
                throw new OidcDomainError('configuration_unavailable')
            return { state, browserToken, expiresAt: new Date(expiresAt) }
        },
        async consume(state, browserToken) {
            if (!isValidOpaqueToken(state) || !isValidOpaqueToken(browserToken)) return null
            const hash = await hashOpaqueToken(state)
            const raw = await send('GET', [key(hash)])
            if (typeof raw !== 'string' || raw.length > OIDC_LIMITS.callbackBytes) return null
            let envelope: z.infer<typeof envelopeSchema>
            try {
                envelope = envelopeSchema.parse(JSON.parse(raw))
            } catch {
                return null
            }
            const now = dependencies.now()
            if (
                envelope.createdAt > now ||
                envelope.expiresAt <= now ||
                envelope.expiresAt - envelope.createdAt !== OIDC_LIMITS.flowDurationMs
            )
                return null
            const browserHash = await hashOpaqueToken(browserToken)
            if (
                !timingSafeEqual(
                    Buffer.from(browserHash, 'hex'),
                    Buffer.from(envelope.browserHash, 'hex'),
                )
            )
                return null
            // The browser check precedes GETDEL so an unrelated browser cannot burn another user's exchange.
            if ((await send('GETDEL', [key(hash)])) !== raw) return null
            const ciphertext = decodeBase64Url(envelope.ciphertext)
            const iv = decodeBase64Url(envelope.iv)
            if (!ciphertext || !iv) return null
            try {
                return flowSchema.parse(
                    JSON.parse(await dependencies.open({ ciphertext, iv }, context(hash))),
                )
            } catch {
                return null
            }
        },
    }
}

export const oidcFlowStore = createOidcFlowStore()
