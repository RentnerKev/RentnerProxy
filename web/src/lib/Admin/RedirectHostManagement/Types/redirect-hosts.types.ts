import type { RedirectHostStatusCode } from '../../../../config/Types/redirect-hosts-config.types.ts'
import type { HostTag } from '@/lib/HostTags/Types/host-tags.types.ts'

export interface RedirectHostSummary {
    readonly tags?: readonly HostTag[]
    readonly id: string
    readonly domains: Array<string>
    readonly destination: string
    readonly statusCode: RedirectHostStatusCode
    readonly preserveRequestUri: boolean
    readonly enabled: boolean
    readonly certificateId: string | null
    readonly createdAt: Date
    readonly updatedAt: Date
}

export type RedirectHostActionResult =
    | { readonly success: false; readonly message: string }
    | {
          readonly success: true
          readonly message: string
          readonly runtimeStatus: 'applied' | 'pending'
      }
