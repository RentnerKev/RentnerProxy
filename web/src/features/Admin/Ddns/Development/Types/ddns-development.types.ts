import type { QueryClient } from '@tanstack/react-query'
import type { DdnsApi } from '../../Types/ddns-ui.types.ts'

export interface DdnsDevelopmentLogicResult {
    readonly state: {
        readonly demoEnabled: boolean
        readonly sessionKey: string
        readonly api: DdnsApi
        readonly queryClient: QueryClient
    }
    readonly handler: {
        readonly toggleDemo: () => void
        readonly resetDemo: () => void
    }
}
