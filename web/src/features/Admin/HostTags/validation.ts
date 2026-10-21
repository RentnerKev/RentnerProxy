import { z } from 'zod'
import { hostTagIdsSchema, hostTagNameSchema } from '@/lib/HostTags/hostTags.ts'
import { hostTagColorSchema } from '@/lib/HostTags/hostTagColor.ts'

export const hostKindSchema = z.enum(['proxy', 'redirect'])
const mutation = z.object({
    kind: hostKindSchema,
    expectedRevision: z.number().int().nonnegative().safe(),
})
export const hostTagMutationSchema = z.discriminatedUnion('action', [
    mutation.extend({
        action: z.literal('create'),
        name: hostTagNameSchema,
        color: hostTagColorSchema.optional(),
    }),
    mutation.extend({
        action: z.literal('rename'),
        tagId: z.uuid().toLowerCase(),
        name: hostTagNameSchema,
        color: hostTagColorSchema.optional(),
    }),
    mutation.extend({ action: z.literal('delete'), tagId: z.uuid().toLowerCase() }),
    mutation.extend({
        action: z.literal('assign'),
        hostId: z.uuid().toLowerCase(),
        tagIds: hostTagIdsSchema,
        expectedTagIds: hostTagIdsSchema,
    }),
])
const dateRange = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
export const hostListQuerySchema = z.object({
    search: z.string().max(256).default(''),
    locale: z.enum(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt']).default('en'),
    pageIndex: z.number().int().min(0).max(1_000_000).default(0),
    pageSize: z.number().int().min(1).max(100).default(10),
    filters: z
        .array(
            z.discriminatedUnion('id', [
                z.object({ id: z.literal('domains'), value: z.string().max(1024) }),
                z.object({ id: z.literal('destination'), value: z.string().max(4096) }),
                z.object({ id: z.literal('forward'), value: z.enum(['http', 'https', '']) }),
                z.object({ id: z.literal('status'), value: z.enum(['enabled', 'disabled', '']) }),
                z.object({
                    id: z.literal('statusCode'),
                    value: z.enum(['301', '302', '307', '308', '']),
                }),
                z.object({ id: z.literal('certificate'), value: z.enum(['http', 'https', '']) }),
                z.object({
                    id: z.literal('tags'),
                    value: z.union([z.uuid(), z.literal('untagged'), z.literal('')]),
                }),
                z.object({ id: z.literal('createdAt'), value: dateRange }),
            ]),
        )
        .max(8)
        .default([]),
    sorting: z
        .array(
            z.object({
                id: z.enum([
                    'domains',
                    'destination',
                    'statusCode',
                    'certificate',
                    'status',
                    'createdAt',
                    'tags',
                ]),
                desc: z.boolean(),
            }),
        )
        .max(7)
        .default([{ id: 'createdAt', desc: true }]),
})
