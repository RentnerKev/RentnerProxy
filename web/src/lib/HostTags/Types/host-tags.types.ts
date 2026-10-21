import type { z } from 'zod'
import type { hostTagStateSchema } from '../hostTags.ts'
import type {
    hostListQuerySchema,
    hostTagMutationSchema,
} from '@/features/Admin/HostTags/validation.ts'

export type HostKind = 'proxy' | 'redirect'
export interface HostTag {
    readonly id: string
    readonly name: string
}
export type HostTagState = z.output<typeof hostTagStateSchema>
export type HostTagMutation = z.output<typeof hostTagMutationSchema>
export type HostListQuery = z.output<typeof hostListQuerySchema>
export interface HostTagCatalog {
    readonly revision: number
    readonly tags: readonly HostTag[]
}
export interface HostPage<T> {
    readonly hosts: T[]
    readonly total: number
    readonly domains: string[]
    readonly tags: readonly HostTag[]
}
