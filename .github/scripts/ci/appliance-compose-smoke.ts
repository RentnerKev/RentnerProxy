import { rm } from 'node:fs/promises'
import { sharedSmokeImage } from '../../../scripts/smoke/images.ts'
import { createApplianceSmokeContext, extendSmokeContext, assertions } from './appliance/context.ts'
import { verifyApplianceStartup } from './appliance/startup.ts'
import { verifyApplianceManagementAndPersistence } from './appliance/management-and-persistence.ts'
import { verifyApplianceProxyTraffic } from './appliance/proxy-traffic.ts'
import { verifyApplianceCrowdsec } from './appliance/crowdsec.ts'
import { verifyApplianceBackup } from './appliance/backup.ts'
import { verifyApplianceRestore } from './appliance/restore.ts'
import { verifyApplianceRestoreSafety } from './appliance/restore-safety.ts'

async function runSmoke(): Promise<void> {
    const context = await createApplianceSmokeContext()
    try {
        const started = extendSmokeContext(context, await verifyApplianceStartup(context))
        const persisted = extendSmokeContext(
            started,
            await verifyApplianceManagementAndPersistence(started),
        )
        const proxy = extendSmokeContext(persisted, await verifyApplianceProxyTraffic(persisted))
        await verifyApplianceCrowdsec(proxy)
        const backup = extendSmokeContext(proxy, await verifyApplianceBackup(proxy))
        const restored = extendSmokeContext(backup, await verifyApplianceRestore(backup))
        await verifyApplianceRestoreSafety(restored)
    } finally {
        context.backend?.stop(true)
        await context.commandFails(
            [...context.compose, 'down', '--volumes', '--remove-orphans'],
            180_000,
        )
        await context.commandFails(
            [...context.restoreCompose, 'down', '--volumes', '--remove-orphans'],
            180_000,
        )
        await context.commandFails(
            [...context.deploymentChangeCompose, 'down', '--volumes', '--remove-orphans'],
            180_000,
        )
        if (!sharedSmokeImage('appliance'))
            await context.commandFails(
                ['docker', 'image', 'rm', '--force', context.imageTag],
                180_000,
            )
        if (!sharedSmokeImage('http3-client'))
            await context.commandFails(['docker', 'image', 'rm', context.http3Image], 180_000)
        await rm(context.temporaryRoot, { force: true, recursive: true })
    }
}

if (import.meta.main) {
    try {
        await runSmoke()
        console.log('Appliance Compose smoke passed: ' + assertions + ' assertions')
    } catch (error) {
        // Assertion messages can contain generated secret values. Keep the type and source location.
        console.error(
            'Appliance Compose smoke failed: ' +
                (error instanceof Error ? error.name : 'unknown error'),
        )
        const locations =
            error instanceof Error
                ? error.stack?.matchAll(
                      /((?:appliance-compose-smoke|appliance[/\\][a-z-]+)\.ts):(\d+):(\d+)/gu,
                  )
                : undefined
        if (locations) {
            for (const location of [...locations].slice(0, 6)) {
                console.error(
                    'at .github/scripts/ci/' +
                        location[1]?.replaceAll('\\', '/') +
                        ':' +
                        location[2] +
                        ':' +
                        location[3],
                )
            }
        }
        process.exitCode = 1
    }
}
