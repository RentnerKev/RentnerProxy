export const coverageThreshold = 90

export const rustCoverageGroupNames = [
    'Rust overall',
    'Rust certificates',
    'Rust ACME',
    'Rust CrowdSec runtime',
    'Rust runtime engine',
    'Rust DNS',
    'Rust management API',
    'Rust proxy',
    'Rust configuration and persistence',
] as const

export const goCoverageGroupNames = [
    'all',
    '.github/scripts/ci',
    'core/caddy-modules/responsecache',
    'core/caddy-modules/responsecache/upstreamobserver',
    'docker/tooling/buildinfo',
] as const

export const coverageSourceRoots = [
    'web/src',
    'scripts',
    '.github/scripts',
    'docker/web',
    'docker/production/backups',
    'vite.config.ts',
    'drizzle.config.ts',
] as const

export const coverageSourceExclusions = [
    { pattern: /^web\/src\/tests\//u, reason: 'test code' },
    { pattern: /\.d\.ts$/u, reason: 'ambient declarations' },
    { pattern: /(?:\.gen|\.generated)\.tsx?$/u, reason: 'generated code' },
    {
        pattern: /^(?:scripts\/coverage\/|\.github\/scripts\/ci\/fixtures\/)/u,
        reason: 'coverage and integration test harness',
    },
    {
        pattern:
            /^(?:scripts\/(?:smoke|runtime-reliability|runtime-scale)\/|scripts\/test-web\.ts$)/u,
        reason: 'integration, performance or unit test runner',
    },
    {
        pattern:
            /^\.github\/scripts\/ci\/(?:appliance(?:[/-])|beta2(?:[/-])|release-compatibility(?:[/.])|managed-backups-smoke\.ts$|proxy-smoke\.ts$|production-smoke-ci\.ts$)/u,
        reason: 'integration test runner',
    },
    {
        pattern:
            /^\.github\/scripts\/(?:ci\/(?:platform-backup\.ts|distribution\/.*\.ts)|release\/(?:candidate|portability)-runtime\.ts)$/u,
        reason: 'native Docker integration test runner',
    },
    { pattern: /(?:^|\/)(?:Fixtures|fixtures)\//u, reason: 'test fixtures' },
    { pattern: /(?:^|\/)[^/]*[.-]fixture(?:[.-][^/]*)?\.tsx?$/u, reason: 'test fixtures' },
] as const

export const typescriptCoverageGroups = [
    { name: 'TypeScript frontend', pattern: /^web\/src\/(?:features|shared|layouts|routes)\//u },
    { name: 'TypeScript shared logic', pattern: /^web\/src\/(?:lib|config)\//u },
    { name: 'TypeScript server', pattern: /^web\/src\/(?:server|db)\//u },
    {
        name: 'TypeScript tooling',
        pattern: /^(?:scripts\/|\.github\/|docker\/|[^/]+\.config\.ts$)/u,
    },
    { name: 'TypeScript authentication', pattern: /^web\/src\/server\/Auth\//u },
    {
        name: 'TypeScript backups',
        pattern:
            /^(?:web\/src\/(?:features\/Admin\/Backups\/|lib\/Backups\/|server\/(?:(?:Admin\/)?Backups\/|Controller\/backups(?:-download)?\.server\.ts$))|scripts\/backup\/|scripts\/production-(?:backup|restore)\.ts$|docker\/production\/backups\/)/u,
    },
] as const
