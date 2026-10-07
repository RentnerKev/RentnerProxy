import type { ApplianceCommand } from '../../fixtures/Types/appliance-storage.types.ts'
export interface PublishedUpgradeBaseline {
    readonly name: 'Alpha 1' | 'Alpha 3'
    readonly image: string
    readonly version: string
    readonly revision: string
    readonly migrationCount: number
    readonly targetName: 'current'
    readonly directoryName: string
}

export interface UpgradeSmokeOptions {
    readonly imageTag: string
    readonly temporaryRoot: string
    readonly upstreamPort: number
    readonly trafficMarker: string
    readonly envFile: string
    readonly environment: NodeJS.ProcessEnv
    readonly command: ApplianceCommand
    readonly commandWithEnvironment: (
        args: string[],
        environment: NodeJS.ProcessEnv,
        timeoutMs?: number,
    ) => Promise<string>
    readonly passed: (label: string) => void
}
