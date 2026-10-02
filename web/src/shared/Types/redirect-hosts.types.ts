import type { RedirectHostStatusCode } from './redirect-hosts-config.types.ts'

export interface RedirectHostSummary {
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
