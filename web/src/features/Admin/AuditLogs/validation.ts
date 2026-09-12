import { z } from 'zod'

import {
    AUDIT_ACTIONS,
    AUDIT_ACTOR_KINDS,
    AUDIT_AUTHENTICATION_METHODS,
    AUDIT_CHANGED_FIELDS,
    AUDIT_FAILURE_CODES,
    AUDIT_RESOURCES,
    AUDIT_RESULTS,
} from '../../../shared/Types/audit-events.types'

export const AUDIT_DEFAULT_LIMIT = 50
export const AUDIT_MAX_LIMIT = 100
export const AUDIT_MAX_CURSOR_BYTES = 512

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
function isValidUtcDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)) {
        return false
    }
    const parsed = Date.parse(value)
    return (
        Number.isFinite(parsed) &&
        new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
    )
}

const utcDateSchema = z.string().max(40).refine(isValidUtcDate)

export const auditMetadataSchema = z.strictObject({
    authenticationMethod: z.enum(AUDIT_AUTHENTICATION_METHODS).optional(),
    reason: z.literal('authentication_failed').optional(),
    failureCode: z.enum(AUDIT_FAILURE_CODES).optional(),
    changedFields: z
        .array(z.enum(AUDIT_CHANGED_FIELDS))
        .max(AUDIT_CHANGED_FIELDS.length)
        .refine((fields) => new Set(fields).size === fields.length)
        .optional(),
    assigned: z.boolean().optional(),
    previousId: uuidSchema.nullable().optional(),
    nextId: uuidSchema.nullable().optional(),
    runtimeStatus: z.enum(['applied', 'pending', 'failed']).optional(),
    count: z.number().int().min(0).max(10_000).optional(),
})

export const auditEventInputSchema = z
    .strictObject({
        actorUserId: uuidSchema.nullable(),
        actorKind: z.enum(AUDIT_ACTOR_KINDS),
        action: z.enum(AUDIT_ACTIONS),
        resource: z.enum(AUDIT_RESOURCES),
        targetId: uuidSchema.nullable(),
        result: z.enum(AUDIT_RESULTS),
        metadata: auditMetadataSchema.optional(),
    })
    .superRefine((event, context) => {
        if ((event.actorKind === 'user') !== (event.actorUserId !== null)) {
            context.addIssue({
                code: 'custom',
                path: ['actorUserId'],
                message: 'Actor identity is inconsistent.',
            })
        }
    })

const cursorSchema = z.strictObject({ timestamp: utcDateSchema, id: uuidSchema })

export const auditEventsQuerySchema = z
    .strictObject({
        actorUserId: uuidSchema.optional(),
        action: z.enum(AUDIT_ACTIONS).optional(),
        resource: z.enum(AUDIT_RESOURCES).optional(),
        result: z.enum(AUDIT_RESULTS).optional(),
        from: utcDateSchema.optional(),
        to: utcDateSchema.optional(),
        cursor: z
            .string()
            .max(AUDIT_MAX_CURSOR_BYTES)
            .regex(/^[A-Za-z0-9_-]+$/u)
            .optional(),
        limit: z.number().int().min(1).max(AUDIT_MAX_LIMIT).default(AUDIT_DEFAULT_LIMIT),
    })
    .superRefine((query, context) => {
        if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
            context.addIssue({ code: 'custom', path: ['from'], message: 'from must precede to' })
        }
    })

export function parseAuditCursor(value: string): { timestamp: string; id: string } {
    let decoded: unknown
    try {
        decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    } catch {
        throw new Error('Invalid audit cursor.')
    }
    return cursorSchema.parse(decoded)
}

export function encodeAuditCursor(timestamp: Date, id: string): string {
    return Buffer.from(JSON.stringify({ timestamp: timestamp.toISOString(), id })).toString(
        'base64url',
    )
}
