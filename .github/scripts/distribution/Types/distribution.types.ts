import type { ImagePlatform } from '../../../../web/src/lib/ApplicationVersion/Types/image-platform.types.ts'

export interface DistributionRelease {
    readonly schemaVersion: 1
    readonly version: string
    readonly revision: string
    readonly digest: string
    readonly platform: ImagePlatform
    readonly packageRevision: number
}

export interface PackageVersion {
    readonly debian: string
    readonly rpmVersion: string
    readonly rpmRelease: string
    readonly channel: 'alpha' | 'beta' | 'stable'
}

export interface DistributionTarget {
    readonly id: 'debian-13' | 'fedora-44'
    readonly format: 'deb' | 'rpm'
    readonly podmanMinimum: '5.4'
    readonly systemdMinimum: 252
}

export interface DistributionPayloadFile {
    readonly path: string
    readonly mode: 0o644 | 0o755
    readonly content: string
}
