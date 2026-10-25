// Update this only for a reviewed data compatibility change, not for each beta.
// A different contract defaults to manual review until a new wire policy is implemented.
export const CURRENT_COMPATIBILITY_PROFILE = {
    generation: 'appliance-v1',
    major: '1',
    sourceChannels: ['beta', 'stable'],
    targetChannels: ['beta', 'stable'],
    minimumSourceVersion: 'v1.0.0-beta.1',
    minimumTargetVersion: 'v1.0.0-beta.2',
    backup: { writtenVersion: 4, acceptedVersions: [4] },
} as const

export const RELEASE_REPOSITORY = 'RentnerKev/RentnerProxy'
export const RELEASE_IMAGE = 'ghcr.io/rentnerkev/rentnerproxy'
export const READINESS_ASSET = 'rentnerproxy-update.json'
