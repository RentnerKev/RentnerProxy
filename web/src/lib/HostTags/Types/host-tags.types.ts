import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'
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
    readonly color?: string | undefined
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

export type ProxyHostListEntry = Pick<
    ProxyHostSummary,
    | 'id'
    | 'domains'
    | 'tags'
    | 'enabled'
    | 'certificateId'
    | 'createdAt'
    | 'forwardHost'
    | 'forwardScheme'
    | 'forwardPort'
>
export type RedirectHostListEntry = Pick<
    RedirectHostSummary,
    | 'id'
    | 'domains'
    | 'tags'
    | 'enabled'
    | 'certificateId'
    | 'createdAt'
    | 'destination'
    | 'statusCode'
>
export type HostListEntry = ProxyHostListEntry | RedirectHostListEntry
