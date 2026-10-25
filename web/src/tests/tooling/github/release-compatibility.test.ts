// oxlint-disable no-await-in-loop -- Run bounded rejection scenarios sequentially for deterministic mock requests.
import type { SourceFetcher } from '../../../../../scripts/compatibility/source-selection.ts'
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import {
    publishedRelease,
    PUBLISHED_RELEASES,
} from '../../../../../scripts/compatibility/published-releases.ts'
import {
    discoverPublishedReleases,
    loadPublishedSource,
    parseCompatibilitySource,
    requestedCompatibilitySources,
    selectCompatibilitySources,
} from '../../../../../scripts/compatibility/source-selection.ts'
import {
    HISTORICAL_COMPATIBILITY_CONFIG,
    loadHistoricalToolClosure,
} from '../../../../../.github/scripts/ci/release-compatibility/historical-dependencies.ts'
import { verifyCompatibilitySource } from '../../../../../scripts/compatibility/source-selection.ts'
import { runSmokeProcess } from '../../../../../scripts/smoke/process.ts'
import { fileURLToPath } from 'node:url'

const beta1 = publishedRelease('beta.1')

test('collects exact-revision publication evidence even for documentation-only main commits', async () => {
    const workflow = Bun.YAML.parse(
        await readFile(
            new URL('../../../../../.github/workflows/release-compatibility.yml', import.meta.url),
            'utf8',
        ),
    ) as {
        on: {
            push: { branches: string[]; paths?: string[]; 'paths-ignore'?: string[] }
            pull_request: { paths: string[] }
        }
    }
    expect(workflow.on.push.branches).toContain('main')
    expect(workflow.on.push).not.toHaveProperty('paths')
    expect(workflow.on.push).not.toHaveProperty('paths-ignore')
    expect(workflow.on.pull_request.paths).toContain('web/src/**')
})

const beta2 = {
    version: 'v1.0.0-beta.2',
    revision: '7ffc45dc99b02b00008e097d91224176596cbc6f',
    digest: 'sha256:b19236d1cc8c45cedbc4d21341b64c9c54082cec309e899c020afdce6d424a04',
    image: 'ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.2@sha256:b19236d1cc8c45cedbc4d21341b64c9c54082cec309e899c020afdce6d424a04',
}

function release(tag = beta2.version, id = 2) {
    return {
        id,
        tag_name: tag,
        draft: false,
        prerelease: false,
        published_at: '2026-10-20T10:00:00Z',
        assets: [{ id: id + 100, name: 'rentnerproxy-update.json', state: 'uploaded', size: 1000 }],
    }
}
function readiness(entry = release()) {
    return {
        schemaVersion: 1,
        releaseId: entry.id,
        tag: entry.tag_name,
        channel: 'beta',
        publishedAt: entry.published_at,
        revision: beta2.revision,
        image: {
            repository: 'ghcr.io/rentnerkev/rentnerproxy',
            digest: beta2.digest,
            platforms: ['linux/amd64', 'linux/arm64'],
        },
        upgrade: { policy: 'beta1-appliance-v1', minimumVersion: beta1.version },
    }
}
const sourceRevision = async (tag: string) => ({
    revision: tag === beta1.version ? beta1.revision : beta2.revision,
    ancestor: true,
})
const loadSource = async () => beta2
function select(
    releases: unknown = [release(beta1.version, 1), release()],
    targetVersion = '0.0.0',
    identity = sourceRevision,
) {
    return selectCompatibilitySources({
        releases,
        targetVersion,
        sourceRevision: identity,
        loadSource,
    })
}

describe('published compatibility source selection', () => {
    test('retains only the immutable Beta 1 bootstrap pin', () => {
        expect(Object.keys(PUBLISHED_RELEASES)).toEqual(['beta.1'])
        expect(beta1.revision).toBe('9efb498bac2cc12fef4823ee7ac9b31444a5ab54')
        expect(beta1.digest).toBe(
            'sha256:f50faba7ab60c4020790576032cc46350778b8cee1eda5cb8efbfa00333c5d9e',
        )
    })
    test('discovers official Beta 2 with prerelease false without a per-beta pin', async () => {
        expect(await select()).toEqual([
            { role: 'fresh', release: null },
            { role: 'oldest', release: beta1 },
            { role: 'previous', release: beta2 },
        ])
    })
    test('deduplicates oldest and previous at the Beta 2 target cutoff', async () => {
        expect(await select(undefined, '1.0.0-beta.2')).toEqual([
            { role: 'fresh', release: null },
            { role: 'oldest', release: beta1 },
        ])
    })
    test('sorts semantic versions independently of publication ordering', async () => {
        const newest = { ...beta2, version: 'v1.0.0-beta.10' }
        const result = await selectCompatibilitySources({
            releases: [release(newest.version, 10), release(), release(beta1.version, 1)],
            targetVersion: '0.0.0',
            sourceRevision,
            loadSource: async () => newest,
        })
        expect(result.at(-1)?.release?.version).toBe(newest.version)
    })
    test('excludes target, future versions, drafts, alpha and unsupported major', async () => {
        const result = await select(
            [
                release(beta1.version, 1),
                release(),
                release('v1.0.0-beta.3', 3),
                release('v2.0.0', 20),
                release('v1.0.0-alpha.6', 6),
                { ...release('v1.0.0-beta.4', 4), draft: true },
            ],
            '1.0.0-beta.3',
        )
        expect(result.at(-1)?.release).toEqual(beta2)
    })
    test('excludes non-ancestors using exact git verifier', async () => {
        expect(
            await select(undefined, '0.0.0', async (tag) => ({
                ...(await sourceRevision(tag)),
                ancestor: tag === beta1.version,
            })),
        ).toEqual([
            { role: 'fresh', release: null },
            { role: 'oldest', release: beta1 },
        ])
    })
    test('stable targets retain supported beta sources', async () => {
        expect((await select(undefined, '1.0.0')).at(-1)?.release).toEqual(beta2)
    })
    test('skips the exact target commit before requiring its not-yet-published readiness', async () => {
        const result = await selectCompatibilitySources({
            releases: [
                release(beta1.version, 1),
                release(),
                { ...release('v1.0.0-beta.3', 3), assets: [] },
            ],
            targetVersion: '0.0.0',
            sourceRevision: async (tag) => ({
                ...(await sourceRevision(tag)),
                isTarget: tag === 'v1.0.0-beta.3',
            }),
            loadSource: async (entry) => {
                if (entry.tag_name !== beta2.version)
                    throw new Error('Target readiness not published yet')
                return beta2
            },
        })
        expect(result.at(-1)?.release).toEqual(beta2)
    })
    test('rejects a reassigned nonancestor source rather than silently falling back', async () => {
        await expect(
            select(undefined, '0.0.0', async (tag) => ({
                revision: tag === beta1.version ? beta1.revision : 'a'.repeat(40),
                ancestor: tag === beta1.version,
            })),
        ).rejects.toThrow('tag and immutable revision disagree')
    })
    test('rejects an existing published source tag reassigned to the exact target commit', async () => {
        await expect(
            select(undefined, '0.0.0', async (tag) => ({
                revision: tag === beta1.version ? beta1.revision : 'a'.repeat(40),
                ancestor: tag === beta1.version,
                isTarget: tag === beta2.version,
            })),
        ).rejects.toThrow('tag and immutable revision disagree')
    })
    test('always checks the immutable Beta 1 bootstrap even when its tag points at target', async () => {
        await expect(
            select(undefined, '0.0.0', async (tag) => ({
                revision: tag === beta1.version ? 'a'.repeat(40) : beta2.revision,
                ancestor: tag !== beta1.version,
                isTarget: tag === beta1.version,
            })),
        ).rejects.toThrow('tag and immutable revision disagree')
    })
    test('rejects existing invalid self-release readiness instead of treating it as absent', async () => {
        const entry = release('v1.0.0-beta.3', 3)
        for (const assets of [
            [...entry.assets, ...entry.assets],
            [{ ...entry.assets[0]!, state: 'new' }],
        ]) {
            await expect(
                selectCompatibilitySources({
                    releases: [release(beta1.version, 1), release(), { ...entry, assets }],
                    targetVersion: '0.0.0',
                    sourceRevision: async (tag) => ({
                        ...(await sourceRevision(tag)),
                        isTarget: tag === entry.tag_name,
                    }),
                    loadSource: (candidate) =>
                        candidate.tag_name === beta2.version
                            ? Promise.resolve(beta2)
                            : loadPublishedSource(candidate),
                }),
            ).rejects.toThrow('asset missing or invalid')
        }
    })
    test('fails closed when the oldest supported source is unavailable', async () => {
        await expect(select([release()])).rejects.toThrow(
            'Required supported published source unavailable',
        )
    })
    test('never falls back when the required latest source lacks metadata', async () => {
        await expect(
            selectCompatibilitySources({
                releases: [release(beta1.version, 1), release()],
                targetVersion: '0.0.0',
                sourceRevision,
                loadSource: async () => {
                    throw new Error('missing readiness')
                },
            }),
        ).rejects.toThrow('missing readiness')
    })
    test('rejects reassigned tags and ambiguous semver aliases', async () => {
        await expect(
            select(undefined, '0.0.0', async () => ({ revision: 'a'.repeat(40), ancestor: true })),
        ).rejects.toThrow('tag and immutable revision disagree')
        await expect(
            select([release(beta1.version, 1), release(), release('1.0.0-beta.2', 3)]),
        ).rejects.toThrow('Ambiguous published source version')
    })
    test.each(['dev', '1.0.0-alpha.7', '2.0.0', '0.0.0-preview'])(
        'rejects invalid target %s',
        async (target) => {
            await expect(select(undefined, target)).rejects.toThrow(
                'Unsupported compatibility target',
            )
        },
    )
    test('manual selection is restricted and previous can alias deduplicated oldest', async () => {
        const all = await select(undefined, '1.0.0-beta.2')
        expect(requestedCompatibilitySources(all, 'push', 'invalid')).toEqual(all)
        expect(requestedCompatibilitySources(all, 'workflow_dispatch', 'previous')).toEqual([
            { role: 'previous', release: beta1 },
        ])
        expect(() =>
            requestedCompatibilitySources(all, 'workflow_dispatch', 'arbitrary:tag'),
        ).toThrow()
        expect(() => requestedCompatibilitySources(all, 'schedule', 'all')).toThrow()
    })
    test('validates immutable matrix binding and rejects arbitrary image repositories or roles', () => {
        expect(
            parseCompatibilitySource(JSON.stringify({ role: 'previous', release: beta2 })).release,
        ).toEqual(beta2)
        for (const value of [
            { role: 'fresh', release: beta2 },
            { role: 'evil', release: null },
            { role: 'previous', release: { ...beta2, image: 'evil:latest' } },
            { role: 'previous', release: { ...beta2, version: 'v2.0.0' } },
        ])
            expect(() => parseCompatibilitySource(JSON.stringify(value))).toThrow()
    })
    test('revalidates the immutable selected source without reselection when another release appears', async () => {
        await verifyCompatibilitySource(beta2, {
            releases: [release(beta1.version, 1), release(), release('v1.0.0-beta.3', 3)],
            targetVersion: '0.0.0',
            sourceRevision,
            loadSource,
        })
        await expect(
            verifyCompatibilitySource(beta2, {
                releases: [release()],
                targetVersion: '0.0.0',
                sourceRevision: async () => ({ revision: 'a'.repeat(40), ancestor: true }),
                loadSource,
            }),
        ).rejects.toThrow('immutable identity disagree')
        await expect(
            verifyCompatibilitySource(beta2, {
                releases: [release()],
                targetVersion: '0.0.0',
                sourceRevision: async () => ({ revision: beta2.revision, ancestor: false }),
                loadSource,
            }),
        ).rejects.toThrow('immutable identity disagree')
    })
})

describe('bounded official GitHub source discovery', () => {
    test('uses the narrow API token only on the initial official asset request', async () => {
        const requests: { url: string; authorization: string | null }[] = []
        await loadPublishedSource(
            release(),
            async (url, options) => {
                requests.push({
                    url,
                    authorization: new Headers(options.headers).get('authorization'),
                })
                return requests.length === 1
                    ? new Response('', {
                          status: 302,
                          headers: {
                              location: 'https://release-assets.githubusercontent.com/file',
                          },
                      })
                    : Response.json(readiness())
            },
            { token: 'fixture-not-a-secret' },
        )
        expect(requests).toEqual([
            {
                url: 'https://api.github.com/repos/RentnerKev/RentnerProxy/releases/assets/102',
                authorization: 'Bearer fixture-not-a-secret',
            },
            { url: 'https://release-assets.githubusercontent.com/file', authorization: null },
        ])
    })
    test('fails on duplicate release identities and an exhausted overall discovery deadline', async () => {
        await expect(
            discoverPublishedReleases(async () =>
                Response.json([release(), release(beta1.version, 2)]),
            ),
        ).rejects.toThrow('release identity')
        const controller = new AbortController()
        controller.abort()
        let requests = 0
        await expect(
            discoverPublishedReleases(
                async () => {
                    requests++
                    return Response.json([])
                },
                { signal: controller.signal },
            ),
        ).rejects.toThrow()
        expect(requests).toBe(0)
    })
    test('exhausts pagination even when a later page contains the newest version', async () => {
        const urls: string[] = []
        const entries = await discoverPublishedReleases((async (url) => {
            urls.push(String(url))
            return Response.json(
                urls.length === 1
                    ? Array.from({ length: 100 }, (_, id) => release(`v0.0.${id}`, id + 1))
                    : [release(beta2.version, 101)],
            )
        }) as SourceFetcher)
        expect(entries).toHaveLength(101)
        expect(urls[1]).toEndWith('per_page=100&page=2')
    })
    test('fails closed on incomplete pagination, malformed pages and HTTP failure', async () => {
        await expect(
            discoverPublishedReleases((async () =>
                Response.json(
                    Array.from({ length: 100 }, (_, id) => release(beta1.version, id + 1)),
                )) as SourceFetcher),
        ).rejects.toThrow('pagination incomplete')
        await expect(
            discoverPublishedReleases(
                (async () => new Response('', { status: 503 })) as SourceFetcher,
            ),
        ).rejects.toThrow('unavailable')
        await expect(
            discoverPublishedReleases((async () => Response.json([{}])) as SourceFetcher),
        ).rejects.toThrow()
    })
    test('loads readiness by official API asset ID and validates Beta 2 identity', async () => {
        let requested = ''
        const actual = await loadPublishedSource(release(), (async (url) => {
            requested = String(url)
            return Response.json(readiness())
        }) as SourceFetcher)
        expect(requested).toBe(
            'https://api.github.com/repos/RentnerKev/RentnerProxy/releases/assets/102',
        )
        expect(actual).toEqual(beta2)
    })
    test('rejects missing, duplicate, pending and oversized readiness assets', async () => {
        const entry = release()
        for (const assets of [
            [],
            [...entry.assets, ...entry.assets],
            [{ ...entry.assets[0]!, state: 'new' }],
            [{ ...entry.assets[0]!, size: 32_769 }],
        ])
            await expect(loadPublishedSource({ ...entry, assets })).rejects.toThrow(
                'asset missing or invalid',
            )
    })
    test('rejects readiness mismatches and unsupported platform or upgrade policy', async () => {
        for (const value of [
            { ...readiness(), releaseId: 999 },
            { ...readiness(), tag: beta1.version },
            { ...readiness(), channel: 'stable' },
            { ...readiness(), publishedAt: '2026-10-21T10:00:00Z' },
            { ...readiness(), revision: 'main' },
            { ...readiness(), upgrade: { policy: 'manual-review', minimumVersion: null } },
            { ...readiness(), image: { ...readiness().image, platforms: ['linux/arm64'] } },
        ])
            await expect(
                loadPublishedSource(release(), (async () => Response.json(value)) as SourceFetcher),
            ).rejects.toThrow('Invalid source readiness')
    })
    test.each([
        'http://github.com/file',
        'https://evil.invalid/file',
        'https://github.com:444/file',
        'https://user@github.com/file',
    ])('rejects unsafe asset redirect %s', async (location) => {
        await expect(
            loadPublishedSource(
                release(),
                (async () =>
                    new Response('', { status: 302, headers: { location } })) as SourceFetcher,
            ),
        ).rejects.toThrow('Unsafe source readiness redirect')
    })
    test('bounds asset bytes and redirect count', async () => {
        await expect(
            loadPublishedSource(
                release(),
                (async () => new Response('x'.repeat(32_769))) as SourceFetcher,
            ),
        ).rejects.toThrow()
        await expect(
            loadPublishedSource(
                release(),
                (async () =>
                    new Response('', {
                        status: 302,
                        headers: { location: 'https://release-assets.githubusercontent.com/file' },
                    })) as SourceFetcher,
            ),
        ).rejects.toThrow('redirect limit')
    })
})

describe('historical backup dependency closure', () => {
    test('can preserve the current backup and restore tools as a future published source', async () => {
        const files = await loadHistoricalToolClosure((path) =>
            readFile(new URL(`../../../../../${path}`, import.meta.url), 'utf8'),
        )
        expect(files.has(HISTORICAL_COMPATIBILITY_CONFIG)).toBe(true)
        expect(files.has('web/src/lib/ApplicationVersion/backupCompatibility.ts')).toBe(true)
        expect(files.has('web/src/lib/Environment/deployment-environment.ts')).toBe(true)
        expect(files.has('scripts/production-backup.ts')).toBe(true)
        expect(files.has('scripts/production-restore.ts')).toBe(true)
    })

    test.each([beta1, beta2])(
        'loads actual immutable $version backup and restore tools with their complete dependency closure',
        async (source) => {
            const files = await loadHistoricalToolClosure(async (path) => {
                const result = await runSmokeProcess(
                    ['git', 'show', `${source.revision}:${path}`],
                    {
                        cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
                        timeoutMs: 10_000,
                    },
                )
                if (result.exitCode !== 0 || result.timedOut)
                    throw new Error(`Historical fixture file unavailable: ${path}`)
                return result.stdout
            })
            expect(files.has('scripts/production-backup.ts')).toBe(true)
            expect(files.has('scripts/production-restore.ts')).toBe(true)
            expect(files.has(HISTORICAL_COMPATIBILITY_CONFIG)).toBe(false)
            if (source.version === beta2.version)
                expect(files.has('scripts/backup/maintenance-commands.ts')).toBe(true)
        },
    )
    test('rejects directory escape, non-allowlisted files, unknown packages and oversized historical files', async () => {
        for (const specifier of [
            '../../evil.ts',
            '../evil.ts',
            './unapproved.ts',
            '@evil/package',
        ]) {
            await expect(
                loadHistoricalToolClosure(async () => `import '${specifier}'`),
            ).rejects.toThrow('unsupported historical tool import')
        }
        await expect(
            loadHistoricalToolClosure(async () => 'x'.repeat(256 * 1024 + 1)),
        ).rejects.toThrow('byte limit')
    })
    test('copies the optional historical config only when the exact historical import closure needs it', async () => {
        const requested: string[] = []
        const files = await loadHistoricalToolClosure(async (path) => {
            requested.push(path)
            return path === 'scripts/production-backup.ts'
                ? "import { CURRENT_COMPATIBILITY_PROFILE } from '../web/src/config/compatibility.config.ts'"
                : 'export const CURRENT_COMPATIBILITY_PROFILE = {}'
        })
        expect(files.has(HISTORICAL_COMPATIBILITY_CONFIG)).toBe(true)
        expect(requested.filter((path) => path === HISTORICAL_COMPATIBILITY_CONFIG)).toHaveLength(1)
    })
    test('full aggregate uses immutable JSON env binding and refuses partial selection', async () => {
        const workflow = Bun.YAML.parse(
            await readFile(
                new URL(
                    '../../../../../.github/workflows/release-compatibility.yml',
                    import.meta.url,
                ),
                'utf8',
            ),
        ) as {
            jobs: Record<
                string,
                {
                    name?: string
                    if?: string
                    steps: { env?: Record<string, string>; run?: string }[]
                }
            >
        }
        const gate = workflow.jobs['compatibility-verified']!
        expect(gate.name).toBe('Compatibility verified')
        expect(gate.if).toContain('always()')
        expect(gate.steps[0]!.run).toContain('test "$COMPLETE" = true')
        expect(
            workflow.jobs['release-compatibility']!.steps.at(-1)!.env?.COMPATIBILITY_SOURCE,
        ).toBe('${{ toJSON(matrix.source) }}')
    })
})
