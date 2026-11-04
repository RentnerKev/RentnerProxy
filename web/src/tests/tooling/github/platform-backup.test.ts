import { describe, expect, test } from 'bun:test'
import { validatePlatformBackupEntries } from '../../../../../.github/scripts/ci/platform-backup.validation.ts'
import { publishedImageArchitectures } from '../../../../../.github/scripts/security/image-platforms.ts'
import { ociIndexType, ociManifestType } from '../../../../../.github/scripts/lib/oci-layout.ts'

describe('portable backup archive boundary', () => {
    const names = [
        'bundle.json',
        'backup/',
        'backup/metadata.json',
        'backup/app-encryption-key',
        'backup/postgres.dump',
        'backup/controller-state.tar',
        'backup/crowdsec-state.tar',
    ]
    const types = ['-', 'd', '-', '-', '-', '-', '-']
    test('accepts the exact regular-file v4 transport layout', () => {
        expect(() => validatePlatformBackupEntries(names, types)).not.toThrow()
    })
    test.each([
        { names: [...names, '../escape'], types: [...types, '-'] },
        { names: [...names.slice(0, -1), '/absolute'], types },
        { names: [...names.slice(0, -1), names[0]!], types },
        { names, types: ['l', ...types.slice(1)] },
        { names, types: ['h', ...types.slice(1)] },
        { names: names.slice(1), types: types.slice(1) },
    ])('rejects traversal, duplicates, symlinks, hardlinks and missing members: %j', (entry) => {
        expect(() => validatePlatformBackupEntries(entry.names, entry.types)).toThrow()
    })
})

const platform = (architecture: string, variant?: string) => ({
    mediaType: ociManifestType,
    digest: 'sha256:' + 'a'.repeat(64),
    size: 1,
    platform: { os: 'linux', architecture, ...(variant ? { variant } : {}) },
})
const index = (manifests: unknown[]) => ({
    schemaVersion: 2,
    mediaType: ociIndexType,
    manifests,
})
describe('deployed immutable platform discovery', () => {
    test('retains old AMD64 images and discovers both native platforms beside attestations', () => {
        expect(
            publishedImageArchitectures({ schemaVersion: 2, mediaType: ociManifestType }),
        ).toEqual(['amd64'])
        expect(
            publishedImageArchitectures(
                index([
                    platform('amd64'),
                    platform('arm64', 'v8'),
                    {
                        ...platform('unknown'),
                        annotations: { 'vnd.docker.reference.type': 'attestation-manifest' },
                    },
                ]),
            ),
        ).toEqual(['amd64', 'arm64'])
    })
    test.each([
        [],
        [platform('arm64')],
        [platform('amd64'), platform('arm64', 'v9')],
        [platform('amd64'), platform('arm64'), platform('arm64', 'v8')],
        [platform('amd64'), platform('riscv64')],
    ])('fails closed on unsupported or ambiguous runtime platforms: %j', (...manifests) => {
        expect(() => publishedImageArchitectures(index(manifests))).toThrow()
    })
})
