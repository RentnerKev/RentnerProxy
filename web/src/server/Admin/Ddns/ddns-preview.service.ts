import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { DDNS_PREVIEW_TTL_MS } from '@/config/ddns.config.ts'
import { ddnsFingerprint } from '@/lib/Ddns/targets.ts'
import { encryptSecret, decryptSecret } from '@/server/Auth/Core/encryption.server.ts'
import { DdnsDomainError } from './ddns.errors.ts'
import type { DdnsReceiptDependencies, DdnsReceiptService } from './Types/ddns.types.ts'

const payloadSchema = z.strictObject({
    revision: z.number().int().min(0).max(4_294_967_295),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
export function createDdnsReceiptService(
    dependencies: DdnsReceiptDependencies,
): DdnsReceiptService {
    return {
        async issue(actor, intent, revision, draft) {
            const expiresAt = dependencies.now() + DDNS_PREVIEW_TTL_MS
            const value = JSON.stringify({
                revision,
                digest: createHash('sha256').update(ddnsFingerprint(draft)).digest('hex'),
                expiresAt,
            })
            try {
                const encrypted = await dependencies.encrypt(
                    value,
                    `ddns-preview:${actor}:${intent}:v1`,
                )
                return {
                    receipt: `${Buffer.from(encrypted.iv).toString('base64url')}.${Buffer.from(encrypted.ciphertext).toString('base64url')}`,
                    expiresAt,
                }
            } catch {
                throw new DdnsDomainError('controller_unavailable')
            }
        },
        async verify(actor, intent, revision, draft, receipt) {
            try {
                if (
                    receipt.length > 2048 ||
                    !/^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{24,1400}$/u.test(receipt)
                )
                    throw new Error('invalid receipt')
                const [iv, ciphertext] = receipt.split('.')
                const value = payloadSchema.parse(
                    JSON.parse(
                        await dependencies.decrypt(
                            {
                                iv: Buffer.from(iv!, 'base64url'),
                                ciphertext: Buffer.from(ciphertext!, 'base64url'),
                            },
                            `ddns-preview:${actor}:${intent}:v1`,
                        ),
                    ),
                )
                if (
                    value.revision !== revision ||
                    value.expiresAt <= dependencies.now() ||
                    value.expiresAt > dependencies.now() + DDNS_PREVIEW_TTL_MS + 1000 ||
                    value.digest !==
                        createHash('sha256').update(ddnsFingerprint(draft)).digest('hex')
                )
                    throw new Error('stale preview')
            } catch {
                throw new DdnsDomainError('preview_required')
            }
        },
    }
}
export const ddnsReceiptService = createDdnsReceiptService({
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    now: Date.now,
})
