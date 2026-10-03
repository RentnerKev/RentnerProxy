import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'

import { CROWDSEC_DASHBOARD_DEMO_KEY } from '@/config/crowdsec.config.ts'
import { systemSettings } from '@/db/schema.ts'
import {
    filterCrowdSecDemoDashboard,
    isLocalCrowdSecDemoEnvironment,
} from '@/lib/Admin/CrowdSec/demoDashboard.ts'
import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { crowdSecDashboardSchema } from '@/server/Controller/crowdsec.server.ts'

export async function getLocalDemoDashboard(
    query: CrowdSecDashboardQuery,
): Promise<CrowdSecDashboard | null> {
    if (!isLocalCrowdSecDemoEnvironment(process.env)) return null
    const [row] = await getAuthDatabase()
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, CROWDSEC_DASHBOARD_DEMO_KEY))
        .limit(1)
    if (!row) return null
    let raw: unknown = row.value
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw)
        } catch {
            return null
        }
    }
    const parsed = crowdSecDashboardSchema.safeParse(raw)
    return parsed.success ? filterCrowdSecDemoDashboard(parsed.data, query) : null
}
