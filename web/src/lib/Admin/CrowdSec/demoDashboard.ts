import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import filterCrowdSecDashboard from './filterCrowdSecDashboard.ts'

function isLoopbackUrl(value: string | undefined): boolean {
    if (!value) return false
    try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)
    } catch {
        return false
    }
}

export function isLocalCrowdSecDemoEnvironment(environment: NodeJS.ProcessEnv): boolean {
    return (
        environment.NODE_ENV === 'development' &&
        isLoopbackUrl(environment.APP_URL) &&
        isLoopbackUrl(environment.DATABASE_URL)
    )
}

export function filterCrowdSecDemoDashboard(
    source: CrowdSecDashboard,
    query: CrowdSecDashboardQuery,
): CrowdSecDashboard {
    return {
        ...filterCrowdSecDashboard(source, query),
        demo: true,
        collectedAt: Math.floor(Date.now() / 1_000),
    }
}
