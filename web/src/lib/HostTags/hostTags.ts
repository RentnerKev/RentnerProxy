import { z } from 'zod'
import { DEFAULT_HOST_TAG_COLOR, HOST_TAG_LIMITS } from '@/config/host-tags.config.ts'
import { hostTagColorSchema } from './hostTagColor.ts'
import type { HostTag, HostTagMutation, HostTagState } from './Types/host-tags.types.ts'

export const hostTagIdsSchema = z
    .array(z.uuid().toLowerCase())
    .max(HOST_TAG_LIMITS.tagsPerHost)
    .refine((ids) => new Set(ids).size === ids.length, 'admin.hostTags.errors.invalid')

export const hostTagNameSchema = z
    .string()
    .max(256)
    .refine((name) => !/[\p{Cc}\p{Cf}]/u.test(name), 'admin.hostTags.errors.invalid')
    .transform((name) => name.normalize('NFKC').trim().replace(/\s+/gu, ' '))
    .pipe(z.string().min(1).max(HOST_TAG_LIMITS.nameLength))

export const hostTagStateSchema = z
    .object({
        version: z.literal(1),
        revision: z.number().int().nonnegative().safe(),
        tags: z
            .array(
                z.object({
                    id: z.uuid().toLowerCase(),
                    name: hostTagNameSchema,
                    color: hostTagColorSchema.optional(),
                }),
            )
            .max(HOST_TAG_LIMITS.tags),
        assignments: z.record(z.uuid(), hostTagIdsSchema),
    })
    .superRefine((state, context) => {
        const ids = new Set(state.tags.map((tag) => tag.id))
        const names = new Set(state.tags.map((tag) => tag.name.toLowerCase()))
        if (
            ids.size !== state.tags.length ||
            names.size !== state.tags.length ||
            Object.values(state.assignments).some((tags) => tags.some((id) => !ids.has(id)))
        ) {
            context.addIssue({ code: 'custom', message: 'Invalid host classification state.' })
        }
    })

export class HostTagDomainError extends Error {
    constructor(readonly code: 'duplicate' | 'missing' | 'conflict' | 'limit' | 'invalid') {
        super('admin.hostTags.errors.' + code)
        this.name = 'HostTagDomainError'
    }
}

export function emptyHostTagState(): HostTagState {
    return { version: 1, revision: 0, tags: [], assignments: {} }
}

export function tagsForHost(state: HostTagState, hostId: string): HostTag[] {
    const ids = new Set(state.assignments[hostId] ?? [])
    return state.tags
        .filter((tag) => ids.has(tag.id))
        .toSorted((a, b) => a.name.localeCompare(b.name))
}

export function assignHostTags(
    state: HostTagState,
    hostId: string,
    input: readonly string[],
): HostTagState {
    const tagIds = hostTagIdsSchema.parse(input).toSorted()
    if (tagIds.some((id) => !state.tags.some((tag) => tag.id === id))) {
        throw new HostTagDomainError('missing')
    }
    if (JSON.stringify(tagIds) === JSON.stringify((state.assignments[hostId] ?? []).toSorted()))
        return state
    const assignments = { ...state.assignments }
    if (tagIds.length) assignments[hostId] = tagIds
    else delete assignments[hostId]
    return { ...state, assignments, revision: state.revision + 1 }
}

export function mutateHostTags(
    state: HostTagState,
    input: HostTagMutation,
    newId: string,
): HostTagState {
    if (state.revision !== input.expectedRevision) throw new HostTagDomainError('conflict')
    if (input.action === 'assign') {
        if (
            JSON.stringify(input.expectedTagIds.toSorted()) !==
            JSON.stringify((state.assignments[input.hostId] ?? []).toSorted())
        )
            throw new HostTagDomainError('conflict')
        return assignHostTags(state, input.hostId, input.tagIds)
    }
    if (input.action === 'create' || input.action === 'rename') {
        const name = hostTagNameSchema.parse(input.name)
        const color = input.color === undefined ? undefined : hostTagColorSchema.parse(input.color)
        if (
            state.tags.some(
                (tag) =>
                    tag.name.toLowerCase() === name.toLowerCase() &&
                    (input.action === 'create' || tag.id !== input.tagId),
            )
        )
            throw new HostTagDomainError('duplicate')
        if (input.action === 'create') {
            if (state.tags.length >= HOST_TAG_LIMITS.tags) throw new HostTagDomainError('limit')
            return {
                ...state,
                revision: state.revision + 1,
                tags: [...state.tags, { id: newId, name, color: color ?? DEFAULT_HOST_TAG_COLOR }],
            }
        }
        if (!state.tags.some((tag) => tag.id === input.tagId))
            throw new HostTagDomainError('missing')
        return {
            ...state,
            revision: state.revision + 1,
            tags: state.tags.map((tag) =>
                tag.id === input.tagId
                    ? { ...tag, name, ...(color !== undefined ? { color } : {}) }
                    : tag,
            ),
        }
    }
    if (!state.tags.some((tag) => tag.id === input.tagId)) throw new HostTagDomainError('missing')
    const assignments = Object.fromEntries(
        Object.entries(state.assignments)
            .map(([id, tags]) => [id, tags.filter((tag) => tag !== input.tagId)] as const)
            .filter(([, tags]) => tags.length),
    )
    return {
        ...state,
        revision: state.revision + 1,
        assignments,
        tags: state.tags.filter((tag) => tag.id !== input.tagId),
    }
}
