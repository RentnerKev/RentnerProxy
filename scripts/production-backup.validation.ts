import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)

const artifact = z.strictObject({
    bytes: z
        .number()
        .int()
        .positive()
        .max(8 * 1024 ** 3),
    sha256: digest,
})

const database = artifact.extend({
    database: z.literal('rentnerproxy'),
    dump: z.literal('postgres.dump'),
    user: z.literal('rentnerproxy'),
})

const key = artifact.extend({ file: z.literal('app-encryption-key') })

const controller = artifact.extend({ archive: z.literal('controller-state.tar') })

const base = {
    applicationEncryptionKey: key,
    controllerState: controller,
    createdAt: z.iso.datetime(),
    format: z.literal('rentnerproxy-production-backup'),
    postgres: database,
    redis: z.literal('excluded'),
}

export const deploymentSchema = z.strictObject({
    publicOrigin: z.string().url().max(4096),
    trustedProxyCidrs: z.string().max(8192),
})

export const metadataSchema = z.discriminatedUnion('version', [
    z.strictObject({ ...base, version: z.literal(3) }),
    z.strictObject({
        ...base,
        version: z.literal(4),
        crowdSecState: artifact.extend({ archive: z.literal('crowdsec-state.tar') }),
        deployment: deploymentSchema,
        source: z.strictObject({
            imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            revision: z.string().max(128).nullable(),
            version: z.string().max(128).nullable(),
        }),
    }),
])
