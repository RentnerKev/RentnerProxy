import { z } from 'zod'
import { BULK_HOST_LIMITS } from '@/config/bulk-hosts.config.ts'
import { hostKindSchema } from '@/features/Admin/HostTags/validation.ts'
import { hostTagIdsSchema } from '@/lib/HostTags/hostTags.ts'

export const bulkHostActionSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('enable') }),
    z.strictObject({ type: z.literal('disable') }),
    z.strictObject({ type: z.literal('addTags'), tagIds: hostTagIdsSchema.min(1) }),
    z.strictObject({ type: z.literal('removeTags'), tagIds: hostTagIdsSchema.min(1) }),
    z.strictObject({
        type: z.literal('accessPolicy'),
        accessPolicyId: z.uuid().toLowerCase().nullable(),
    }),
    z.strictObject({
        type: z.literal('certificate'),
        certificateId: z.uuid().toLowerCase().nullable(),
    }),
])

const hostId = z.uuid().toLowerCase()
export const bulkHostPreviewSchema = z.strictObject({
    kind: hostKindSchema,
    action: bulkHostActionSchema,
    hostIds: z
        .array(hostId)
        .min(1)
        .max(BULK_HOST_LIMITS.hosts)
        .refine((ids) => new Set(ids).size === ids.length),
})
export const bulkHostApplySchema = z.strictObject({
    kind: hostKindSchema,
    action: bulkHostActionSchema,
    hosts: z
        .array(z.strictObject({ id: hostId, version: z.string().regex(/^[a-f0-9]{64}$/u) }))
        .min(1)
        .max(BULK_HOST_LIMITS.hosts)
        .refine((hosts) => new Set(hosts.map((host) => host.id)).size === hosts.length),
})
