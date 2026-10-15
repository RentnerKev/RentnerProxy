import { z } from 'zod'
import { isIP } from 'node:net'

const id = z
    .string()
    .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u)
const zoneId = z.string().regex(/^[a-f0-9]{32}$/u)
const zone = z.strictObject({
    id: zoneId,
    name: z
        .string()
        .min(1)
        .max(253)
        .refine(
            (value) =>
                isIP(value) === 0 &&
                value
                    .split('.')
                    .every(
                        (label) =>
                            label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
                    ),
        ),
})
const reference = z.strictObject({
    zoneId,
    consumer: z.strictObject({ type: z.enum(['dns01', 'ddns']), id }),
})
const bytes = z.array(z.number().int().min(0).max(255))
const metadata = z.strictObject({
    id,
    provider: z.literal('cloudflare'),
    ownership: z.literal('instance'),
    name: z
        .string()
        .min(1)
        .max(100)
        .refine(
            (value) =>
                value.length <= 100 && value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value),
        ),
    createdByUserId: id,
    revision: z.number().int().min(1).max(4_294_967_295),
    zones: z.array(zone).min(1).max(50),
    references: z.array(reference).max(10_000).default([]),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
})
const registry = z.strictObject({
    version: z.literal(1),
    connections: z
        .array(
            z.strictObject({
                metadata,
                secret: z.strictObject({
                    version: z.literal(1),
                    nonce: bytes.length(12),
                    ciphertext: bytes.min(17).max(528),
                }),
            }),
        )
        .max(100),
})

function invalidRegistry(): Error {
    return new Error('invalid DNS connection state metadata')
}

export function validateDnsConnectionsBackup(
    content: Uint8Array,
    decrypt: (ciphertext: Uint8Array, nonce: Uint8Array, context: string) => void,
): void {
    if (content.byteLength > 1_048_576) throw invalidRegistry()
    let document: unknown
    try {
        document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content))
    } catch {
        throw invalidRegistry()
    }
    const parsed = registry.safeParse(document)
    if (!parsed.success) throw invalidRegistry()
    const connectionIds = new Set<string>()
    const names = new Set<string>()
    for (const { metadata: connection, secret } of parsed.data.connections) {
        const name = connection.name.toLowerCase()
        if (connectionIds.has(connection.id) || names.has(name)) throw invalidRegistry()
        connectionIds.add(connection.id)
        names.add(name)
        if (Date.parse(connection.updatedAt) < Date.parse(connection.createdAt))
            throw invalidRegistry()
        const zones = new Set(connection.zones.map((entry) => entry.id))
        if (zones.size !== connection.zones.length) throw invalidRegistry()
        const references = new Set<string>()
        for (const entry of connection.references) {
            const key = `${entry.zoneId}:${entry.consumer.type}:${entry.consumer.id}`
            if (!zones.has(entry.zoneId) || references.has(key)) throw invalidRegistry()
            references.add(key)
        }
        decrypt(
            new Uint8Array(secret.ciphertext),
            new Uint8Array(secret.nonce),
            `dns-connection:${connection.id}:v1`,
        )
    }
}
