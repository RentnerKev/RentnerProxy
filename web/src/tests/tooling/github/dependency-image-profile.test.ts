import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import {
    evaluateInventory,
    getImageAssessmentProfile,
} from '../../../../../.github/scripts/security/dependency-policy.ts'
import { PUBLISHED_ALPHAS } from '../../../../../scripts/release-compatibility/published-alphas.ts'

const alpha6 = PUBLISHED_ALPHAS['alpha.6']
const legacyIdentity = { revision: alpha6.revision, digest: alpha6.digest }
const currentIdentity = {
    revision: 'bfd596b9784056c4fa076545b5362a3f22aba57a',
    digest: `sha256:${'a'.repeat(64)}`,
}
const legacyArtifacts = [
    { name: 'bun', version: '1.4.2', type: 'binary' },
    { name: 'redis', version: '8.10.1', type: 'binary' },
    { name: 'postgresql-18', version: '18.6', type: 'deb' },
    { name: 'github.com/caddyserver/caddy/v2', version: 'v2.11.4', type: 'go-module' },
    { name: 'react', version: '19', type: 'npm' },
]
const currentArtifacts = [
    ...legacyArtifacts.filter((artifact) => artifact.name !== 'redis'),
    { name: 'valkey', version: '9.1.0', type: 'binary' },
    { name: 'github.com/crowdsecurity/crowdsec', version: 'v1.7.7', type: 'go-module' },
]

describe('immutable runtime assessment profiles', () => {
    test('selects Alpha6 only for its canonical source and index digest together', () => {
        expect(getImageAssessmentProfile(legacyIdentity)).toEqual({
            ...legacyIdentity,
            profile: 'published-alpha.6',
            cachePackage: 'redis',
            goBinaries: [{ name: 'caddy', path: '/usr/bin/caddy' }],
            communityModuleQuery: false,
            cargoLockSourcePath: 'controller/Cargo.lock',
        })
        expect(() =>
            evaluateInventory({ artifacts: legacyArtifacts }, legacyIdentity),
        ).not.toThrow()
    })

    test('keeps every other immutable identity on the current strict profile', () => {
        const identities = [
            { ...legacyIdentity, revision: 'a'.repeat(40) },
            { ...legacyIdentity, digest: `sha256:${'b'.repeat(64)}` },
            PUBLISHED_ALPHAS['alpha.5'],
            currentIdentity,
        ]
        for (const identity of identities) {
            expect(getImageAssessmentProfile(identity)).toMatchObject({
                profile: 'current',
                cachePackage: 'valkey',
                goBinaries: [
                    { name: 'caddy', path: '/usr/bin/caddy' },
                    { name: 'crowdsec', path: '/usr/local/bin/crowdsec' },
                    { name: 'cscli', path: '/usr/local/bin/cscli' },
                ],
                communityModuleQuery: true,
                cargoLockSourcePath: 'core/Cargo.lock',
            })
            expect(() => evaluateInventory({ artifacts: legacyArtifacts }, identity)).toThrow(
                'valkey',
            )
            expect(() => evaluateInventory({ artifacts: currentArtifacts }, identity)).not.toThrow()
        }
        expect(() => evaluateInventory({ artifacts: legacyArtifacts })).toThrow('valkey')
    })

    test('still rejects missing expected Alpha6, OS and JavaScript inventory', () => {
        for (const name of ['redis', 'github.com/caddyserver/caddy/v2', 'postgresql-18', 'react']) {
            expect(() =>
                evaluateInventory(
                    {
                        artifacts: legacyArtifacts.filter((artifact) => artifact.name !== name),
                    },
                    legacyIdentity,
                ),
            ).toThrow()
        }
        expect(() =>
            evaluateInventory(
                {
                    artifacts: legacyArtifacts.filter((artifact) => artifact.type !== 'deb'),
                },
                legacyIdentity,
            ),
        ).toThrow()
        expect(() =>
            evaluateInventory(
                {
                    artifacts: currentArtifacts.filter(
                        (artifact) => artifact.name !== 'github.com/crowdsecurity/crowdsec',
                    ),
                },
                currentIdentity,
            ),
        ).toThrow('crowdsec')
    })

    test('rejects invalid identity instead of selecting any profile', () => {
        expect(() => getImageAssessmentProfile({ ...legacyIdentity, revision: 'main' })).toThrow(
            'immutable',
        )
        expect(() => getImageAssessmentProfile({ ...legacyIdentity, digest: 'latest' })).toThrow(
            'immutable',
        )
        expect(() => evaluateInventory({ artifacts: legacyArtifacts }, {})).toThrow()
    })

    test('CLI writes identity-bound evidence and inventory cannot select a profile from environment flags', async () => {
        const temporaryRoot = resolve(tmpdir())
        const prefix = 'rentnerproxy-image-profile-'
        const directory = await mkdtemp(join(temporaryRoot, prefix))
        if (
            dirname(resolve(directory)) !== temporaryRoot ||
            !basename(directory).startsWith(prefix)
        ) {
            throw new Error('Refusing cleanup outside the owned test directory.')
        }
        try {
            const policy = resolve(
                import.meta.dir,
                '../../../../../.github/scripts/security/dependency-policy.ts',
            )
            const inventory = join(directory, 'inventory.json')
            await writeFile(inventory, JSON.stringify({ artifacts: legacyArtifacts }))
            const cases = [
                legacyIdentity,
                { ...legacyIdentity, digest: `sha256:${'b'.repeat(64)}` },
            ]
            const results = await Promise.all(
                cases.map(async (identity, index) => {
                    const identityPath = join(directory, `identity-${index}.json`)
                    const evidencePath = join(directory, `profile-${index}.json`)
                    await writeFile(identityPath, JSON.stringify(identity))
                    const environment = {
                        DEPENDENCY_IMAGE_PROFILE: 'published-alpha.6',
                        CACHE_PACKAGE: 'redis',
                    }
                    const profile = Bun.spawn(
                        [
                            process.execPath,
                            '--no-env-file',
                            policy,
                            'profile',
                            identityPath,
                            evidencePath,
                        ],
                        {
                            cwd: directory,
                            env: environment,
                            stdout: 'ignore',
                            stderr: 'ignore',
                        },
                    )
                    expect(await profile.exited).toBe(0)
                    const evidence: unknown = JSON.parse(await readFile(evidencePath, 'utf8'))
                    expect(evidence).toEqual(getImageAssessmentProfile(identity))
                    const assessed = Bun.spawn(
                        [
                            process.execPath,
                            '--no-env-file',
                            policy,
                            'inventory',
                            inventory,
                            identityPath,
                        ],
                        {
                            cwd: directory,
                            env: environment,
                            stdout: 'ignore',
                            stderr: 'ignore',
                        },
                    )
                    return assessed.exited
                }),
            )
            expect(results).toEqual([0, 1])
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
