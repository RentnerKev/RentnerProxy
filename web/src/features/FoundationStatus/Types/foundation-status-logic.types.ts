import type { FoundationHealth } from '@/shared/Types/health.types.ts'
import type { LiveStatus } from './foundation-status.types.ts'
export interface FoundationStatusLogicResult {
    state: {
        canViewCrowdSec: boolean
        data: FoundationHealth | undefined
        isError: boolean
        isPending: boolean
        liveStatus: LiveStatus
    }
    handler: { retry: () => void }
}
