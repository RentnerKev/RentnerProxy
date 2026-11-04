import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
    assertCoverageSourcesUnchanged,
    createCoverageBaseline,
} from '../../../../../../scripts/coverage/sources.ts'
import {
    coverageSourceExclusions,
    coverageSourceRoots,
} from '../../../../../../scripts/coverage/coverage.config.ts'
import { clearPublishedCoverage } from '../../../../../../scripts/coverage/published.ts'

const isExcludedCoverageSource = (path: string) =>
    coverageSourceExclusions.some((rule) => rule.pattern.test(path))

test('native integration runners are exercised by Docker CI while pure publication validators stay in unit coverage', () => {
    for (const path of [
        '.github/scripts/ci/platform-backup.ts',
        '.github/scripts/release/candidate-runtime.ts',
        '.github/scripts/release/portability-runtime.ts',
    ])
        expect(isExcludedCoverageSource(path)).toBe(true)
    for (const path of [
        '.github/scripts/ci/platform-backup.validation.ts',
        '.github/scripts/release/multiarch-image.ts',
        '.github/scripts/lib/oci-layout.ts',
        '.github/scripts/security/image-platforms.ts',
    ])
        expect(isExcludedCoverageSource(path)).toBe(false)
})

test('baseline hashes the exact instrumented bytes and detects added, deleted and formerly type-only source changes', async () => {
    const parent = resolve(import.meta.dir, '../../../../../../tmp/coverage-source-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected source fixture directory.')
    const source = 'throw new Error("not executed"); export const unimported = () => 42'
    try {
        await Promise.all(
            coverageSourceRoots.map((path) =>
                path.endsWith('.ts')
                    ? writeFile(join(directory, path), 'export type Only = string')
                    : mkdir(join(directory, path), { recursive: true }),
            ),
        )
        await writeFile(join(directory, 'web/src/source.ts'), source)
        await writeFile(
            join(directory, 'web/src/typeOnly.ts'),
            'export interface Only { name: string }',
        )
        await mkdir(join(directory, 'web/src/tests'))
        await writeFile(
            join(directory, 'web/src/tests/test.ts'),
            'export enum ExcludedTestEnum { ready }',
        )
        const cache = join(directory, 'cached')
        const { baseline, excluded, hashes } = await createCoverageBaseline(directory, cache)
        expect(Object.keys(baseline)).toEqual(['web/src/source.ts'])
        expect(hashes['web/src/source.ts']).toBe(createHash('sha256').update(source).digest('hex'))
        expect(hashes['web/src/typeOnly.ts']).toBeDefined()
        expect(hashes['web/src/tests/test.ts']).toBeUndefined()
        expect(excluded).toContainEqual({ path: 'web/src/tests/test.ts', reason: 'test code' })
        expect(excluded).toContainEqual({
            path: 'web/src/typeOnly.ts',
            reason: 'no executable statements or functions',
        })
        expect(await readFile(join(cache, 'web/src/source.ts'), 'utf8')).toContain('cov_')
        await assertCoverageSourcesUnchanged(directory, hashes)
        await writeFile(join(directory, 'web/src/source.ts'), source + '\nexport const added = 1')
        await expect(assertCoverageSourcesUnchanged(directory, hashes)).rejects.toThrow(
            'sources changed',
        )
        await writeFile(join(directory, 'web/src/source.ts'), source)
        await writeFile(
            join(directory, 'web/src/typeOnly.ts'),
            'export const nowExecutable = () => 1',
        )
        await expect(assertCoverageSourcesUnchanged(directory, hashes)).rejects.toThrow(
            'sources changed',
        )
        await writeFile(
            join(directory, 'web/src/typeOnly.ts'),
            'export interface Only { name: string }',
        )
        await writeFile(join(directory, 'web/src/new.ts'), 'export const newlyAdded = 1')
        await expect(assertCoverageSourcesUnchanged(directory, hashes)).rejects.toThrow(
            'inventory changed',
        )
        await rm(join(directory, 'web/src/new.ts'))
        await rm(join(directory, 'web/src/source.ts'))
        await expect(assertCoverageSourcesUnchanged(directory, hashes)).rejects.toThrow(
            'inventory changed',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('new coverage runs invalidate published success reports while preserving diagnostic raw runs', async () => {
    const parent = resolve(import.meta.dir, '../../../../../../tmp/coverage-published-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected published fixture directory.')
    try {
        await Promise.all(
            ['summary.json', 'summary.md', 'coverage.json', 'sources.json', 'diagnostics.json'].map(
                (name) => writeFile(join(directory, name), 'previous successful run'),
            ),
        )
        await clearPublishedCoverage(directory, true)
        await Promise.all(
            ['summary.json', 'summary.md', 'coverage.json', 'sources.json'].map((name) =>
                expect(readFile(join(directory, name))).rejects.toThrow('ENOENT'),
            ),
        )
        expect(await readFile(join(directory, 'diagnostics.json'), 'utf8')).toBe(
            'previous successful run',
        )
        await clearPublishedCoverage(directory, true)
        await writeFile(join(directory, 'summary.json'), 'old combined report')
        await clearPublishedCoverage(directory)
        await expect(readFile(join(directory, 'summary.json'))).rejects.toThrow('ENOENT')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
