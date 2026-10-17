import { z } from 'zod'
import { dockerEndpointSchema } from './validation.ts'

export const discoveryRegistrySchema = z.strictObject({
    version: z.literal(1),
    revision: z.number().int().nonnegative().max(4_294_967_295),
    enabled: z.boolean(),
    actorUserId: z.uuidv7().nullable(),
    connectorRevision: z.number().int().nonnegative().nullable(),
    endpointHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .nullable(),
    runtimeStatus: z.enum(['idle', 'pending', 'applied']),
    error: z.enum(['authorization_required', 'reconcile_failed']).nullable(),
    results: z
        .array(
            z.strictObject({
                key: z.string().regex(/^[a-f0-9]{64}$/u),
                error: z.enum([
                    'reference_invalid',
                    'authorization_required',
                    'reconcile_failed',
                    'owner_limit',
                ]),
            }),
        )
        .max(256),
    owners: z
        .array(
            z.strictObject({
                key: z.string().regex(/^[a-f0-9]{64}$/u),
                sourceId: z.string().min(1).max(265),
                hostId: z.uuidv7(),
                containerId: z.string().regex(/^[a-f0-9]{64}$/u),
                domains: z.array(z.string().min(1).max(253)).max(100),
                state: z.enum(['managed', 'orphaned', 'detached']),
                error: z
                    .enum([
                        'reference_invalid',
                        'authorization_required',
                        'reconcile_failed',
                        'host_missing',
                    ])
                    .nullable(),
            }),
        )
        .max(1024),
})
export const discoveryConnectSchema = z.strictObject({
    expectedRevision: z.number().int().nonnegative(),
    connectorRevision: z.number().int().nonnegative(),
    endpoint: dockerEndpointSchema,
    acknowledgeRestore: z.boolean(),
})
export const discoveryInspectSchema = z.strictObject({ endpoint: dockerEndpointSchema })
export const discoveryActionSchema = z
    .strictObject({
        expectedRevision: z.number().int().nonnegative(),
        action: z.enum(['enable', 'disable', 'retry', 'detach']),
        previewToken: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
        key: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .optional(),
    })
    .superRefine((input, context) => {
        if (
            (input.action === 'enable' && !input.previewToken) ||
            (input.action === 'detach' && !input.key)
        )
            context.addIssue({
                code: 'custom',
                message: 'admin.dockerDiscovery.errors.invalid_input',
            })
    })
