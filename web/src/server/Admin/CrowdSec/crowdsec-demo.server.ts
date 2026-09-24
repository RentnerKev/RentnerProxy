import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'

import { CROWDSEC_DASHBOARD_DEMO_KEY } from '../../../config/crowdsec.config'
import { systemSettings } from '../../../db/schema'
import {
    filterCrowdSecDemoDashboard,
    isLocalCrowdSecDemoEnvironment,
} from '../../../features/Admin/CrowdSec/Helpers/demoDashboard'
import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '../../../shared/Types/crowdsec.types'
import { getAuthDatabase } from '../../Auth/Core/database.server'
import { crowdSecDashboardSchema } from '../../Foundation/controller.server'

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
