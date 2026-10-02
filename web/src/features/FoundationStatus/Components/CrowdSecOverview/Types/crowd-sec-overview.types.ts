import type { getCrowdSecConfigurationHandler } from '@/features/Admin/CrowdSec/middleware.ts'
export interface CrowdSecOverviewLogicResult {
    state: {
        configuration: Awaited<ReturnType<typeof getCrowdSecConfigurationHandler>> | undefined
        isPending: boolean
        isError: boolean
    }
    handler: { retry: () => void }
}
