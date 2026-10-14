import type { createApplianceSmokeContext } from '../context.ts'
import type { verifyApplianceStartup } from '../startup.ts'
import type { verifyApplianceManagementAndPersistence } from '../management-and-persistence.ts'
import type { verifyApplianceProxyTraffic } from '../proxy-traffic.ts'
import type { verifyApplianceCrowdsec } from '../crowdsec.ts'
import type { verifyApplianceBackup } from '../backup.ts'
import type { verifyApplianceRestore } from '../restore.ts'

export type ApplianceStartupContext = Awaited<ReturnType<typeof createApplianceSmokeContext>>
export type ApplianceManagementAndPersistenceContext = ApplianceStartupContext &
    Awaited<ReturnType<typeof verifyApplianceStartup>>
export type ApplianceProxyTrafficContext = ApplianceManagementAndPersistenceContext &
    Awaited<ReturnType<typeof verifyApplianceManagementAndPersistence>>
export type ApplianceCrowdsecContext = ApplianceProxyTrafficContext &
    Awaited<ReturnType<typeof verifyApplianceProxyTraffic>>
export type ApplianceBackupContext = ApplianceCrowdsecContext &
    Awaited<ReturnType<typeof verifyApplianceCrowdsec>>
export type ApplianceRestoreContext = ApplianceBackupContext &
    Awaited<ReturnType<typeof verifyApplianceBackup>>
export type ApplianceRestoreSafetyContext = ApplianceRestoreContext &
    Awaited<ReturnType<typeof verifyApplianceRestore>>
