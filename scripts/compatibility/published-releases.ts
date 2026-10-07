import type { PublishedRelease, PublishedReleaseKey } from './Types/published-releases.types.ts'

const image = 'ghcr.io/rentnerkev/rentnerproxy'

export const PUBLISHED_RELEASES = {
    'alpha.1': {
        version: 'v1.0.0-alpha.1',
        digest: 'sha256:f88edb70a80db7c527e1a963e835593f6998ab4541f810e26cf75ffa63da0d3f',
        revision: 'a147176c6096935dc5d9824f671b5f21d89b636b',
        migrationCount: 13,
        schemaTables: 20,
        schemaSha256: '2ccb805f360d9bc59360fa625ad1bb29c12eba32bb8c4ea5779bf69cf3766889',
        capabilities: {
            accessPolicies: false,
            basicAuth: false,
            ipRules: false,
            certificateCandidates: false,
            durableCertificateOperations: false,
            certificateBindingJobs: false,
            auditEvents: false,
        },
    },
    'alpha.2': {
        version: 'v1.0.0-alpha.2',
        digest: 'sha256:b96238a2d4e04cb40cc5b759113f8bc08bef25da3bb97fef9c0cd88748e9e582',
        revision: '8a28311b4e52d7c90446be08d7729093990a7459',
        migrationCount: 17,
        schemaTables: 23,
        schemaSha256: '2603ba4139e4972882a8029ea835d097a711c9c179ab60a09ce945036e67cb8b',
        capabilities: {
            accessPolicies: true,
            basicAuth: true,
            ipRules: true,
            certificateCandidates: false,
            durableCertificateOperations: false,
            certificateBindingJobs: false,
            auditEvents: true,
        },
    },
    'alpha.3': {
        version: 'v1.0.0-alpha.3',
        digest: 'sha256:90d2a921daf7eeb116d18c4fbfabee7a2d937e05d031453affc1f3921e440483',
        revision: 'a1bb0117828606cd10919871a098eb3a794b912e',
        migrationCount: 17,
        schemaTables: 23,
        schemaSha256: '2603ba4139e4972882a8029ea835d097a711c9c179ab60a09ce945036e67cb8b',
        capabilities: {
            accessPolicies: true,
            basicAuth: true,
            ipRules: true,
            certificateCandidates: false,
            durableCertificateOperations: false,
            certificateBindingJobs: false,
            auditEvents: true,
        },
    },
    'alpha.4': {
        version: 'v1.0.0-alpha.4',
        digest: 'sha256:2ac30c6566fa76c2c9d798e9de782d9e7ae7179e07b296afa80fd928e2852929',
        revision: 'a383ac715ba51530449c3ef377723c1e11d3753a',
        migrationCount: 20,
        schemaTables: 26,
        schemaSha256: '1d733a8564dfed48a539f73f5a994b5f8cb517de999fd4e94b2e0119302c81f1',
        capabilities: {
            accessPolicies: true,
            basicAuth: true,
            ipRules: true,
            certificateCandidates: true,
            durableCertificateOperations: true,
            certificateBindingJobs: true,
            auditEvents: true,
        },
    },
    'alpha.5': {
        version: 'v1.0.0-alpha.5',
        digest: 'sha256:2a00a60a917df4bdabc34a6ec19022ef41f9b95df082312bb33ba28325f277f9',
        revision: 'c262bf850f3a3c28065378317506549f60ad3ac1',
        migrationCount: 20,
        schemaTables: 26,
        schemaSha256: '1d733a8564dfed48a539f73f5a994b5f8cb517de999fd4e94b2e0119302c81f1',
        capabilities: {
            accessPolicies: true,
            basicAuth: true,
            ipRules: true,
            certificateCandidates: true,
            durableCertificateOperations: true,
            certificateBindingJobs: true,
            auditEvents: true,
        },
    },
    'alpha.6': {
        version: 'v1.0.0-alpha.6',
        digest: 'sha256:bd20add05064c37275ec23f6dc0a2a84595734dcd047f7595d0321f232b95065',
        revision: 'c8a07cc413c1d9632d279e6d45cdf4d46f4947b1',
        migrationCount: 20,
        schemaTables: 26,
        schemaSha256: '1d733a8564dfed48a539f73f5a994b5f8cb517de999fd4e94b2e0119302c81f1',
        capabilities: {
            accessPolicies: true,
            basicAuth: true,
            ipRules: true,
            certificateCandidates: true,
            durableCertificateOperations: true,
            certificateBindingJobs: true,
            auditEvents: true,
        },
    },
} as const satisfies Record<string, Omit<PublishedRelease, 'image'>>

export function publishedRelease(key: PublishedReleaseKey): PublishedRelease {
    const release = PUBLISHED_RELEASES[key]
    return { ...release, image: image + ':' + release.version + '@' + release.digest }
}
