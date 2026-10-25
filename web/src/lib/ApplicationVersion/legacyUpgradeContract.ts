// Historical schema-one protocol understood by published Beta 1/2 clients.
// These values are a protocol snapshot, not settings for the next release.
export const LEGACY_UPGRADE_CONTRACT = {
    schemaVersion: 1,
    policy: 'beta1-appliance-v1',
    profile: {
        generation: 'appliance-v1',
        major: '1',
        sourceChannels: ['beta', 'stable'],
        targetChannels: ['beta', 'stable'],
        minimumSourceVersion: 'v1.0.0-beta.1',
        minimumTargetVersion: 'v1.0.0-beta.2',
        backup: { writtenVersion: 4, acceptedVersions: [4] },
    },
} as const
