import type { NativeImageEvidence, OciImageIdentity } from '../../lib/Types/oci-layout.types.ts'

export interface PortabilityEvidence extends OciImageIdentity {
    readonly schemaVersion: 1
    readonly sourceManifest: string
    readonly targetManifest: string
    readonly backupVersion: 4
    readonly checks: 'amd64-backup-to-native-arm64'
    readonly nativeUpgradeSources: readonly string[]
}

export interface MultiarchImageEvidence extends OciImageIdentity {
    readonly schemaVersion: 1
    readonly digest: string
    readonly runId: string
    readonly native: readonly NativeImageEvidence[]
    readonly portability: PortabilityEvidence
}
