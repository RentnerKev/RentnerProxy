export type OciArchitecture = 'amd64' | 'arm64'

export interface OciDescriptor {
    readonly data?: string
    readonly mediaType: string
    readonly digest: string
    readonly size: number
    readonly platform?: {
        readonly os: string
        readonly architecture: string
        readonly variant?: string
    }
    readonly annotations?: Readonly<Record<string, string>>
    readonly artifactType?: string
}

export interface OciImageIdentity {
    readonly revision: string
    readonly version: string
}

export interface OciLayoutImage {
    readonly digest: string
    readonly descriptors: readonly OciDescriptor[]
    readonly images: ReadonlyMap<OciArchitecture, OciDescriptor>
    readonly imageIds: ReadonlyMap<OciArchitecture, string>
    readonly blobs: ReadonlyMap<string, { readonly path: string; readonly size: number }>
}

export interface NativeImageEvidence extends OciImageIdentity {
    readonly schemaVersion: 1
    readonly architecture: OciArchitecture
    readonly digest: string
    readonly manifestDigest: string
    readonly imageId: string
    readonly archiveSha256: string
    readonly runId: string
    readonly runAttempt: number
    readonly checks: 'native-appliance-and-drain'
}
