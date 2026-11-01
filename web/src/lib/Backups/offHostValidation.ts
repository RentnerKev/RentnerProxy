import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const timestamp = z.number().int().nonnegative().safe()
const text = (maximum: number) =>
    z
        .string()
        .max(maximum)
        .regex(/^\P{Cc}*$/u)

export const offHostConfigurationAuditSchema = z.strictObject({
    requestId: z.uuid(),
    actorId: z.uuid(),
    fingerprint: digest,
})

export const offHostConfigurationUpdateSchema = z.strictObject({
    requestId: z.uuid(),
    actorId: z.uuid(),
    expectedRevision: timestamp,
    enabled: z.boolean(),
    endpoint: text(512),
    region: text(64),
    bucket: text(63),
    prefix: text(256),
    accessKeyId: text(256).optional(),
    secretAccessKey: text(512).optional(),
    recoveryKey: z
        .string()
        .regex(/^[A-Za-z0-9+/]{43}=$/u)
        .optional(),
    recoveryKeySaved: z.boolean().optional(),
})

export const offHostStatusSchema = z.strictObject({
    revision: timestamp,
    enabled: z.boolean(),
    endpoint: text(512),
    region: text(64),
    bucket: text(63),
    prefix: text(256),
    configured: z.boolean(),
    targetId: z.uuid().nullable(),
    keyId: digest.nullable(),
    retainedCopies: z.number().int().nonnegative().max(100),
})

export const offHostReceiptSchema = z.strictObject({
    state: z.literal('succeeded'),
    targetId: z.uuid(),
    keyId: digest,
    objectKey: text(512).min(1),
    sha256: digest,
    bytes: z.number().int().positive().safe(),
    verifiedAt: timestamp,
})

export const offHostJobSchema = z.discriminatedUnion('state', [
    offHostReceiptSchema,
    z.strictObject({ state: z.literal('uploading') }),
    z.strictObject({ state: z.literal('failed'), error: z.enum(['upload_failed', 'interrupted']) }),
])
