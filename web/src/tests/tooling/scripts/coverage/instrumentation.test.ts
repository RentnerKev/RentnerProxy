import { describe, expect, test } from 'bun:test'
import { createCoverageMap } from 'istanbul-lib-coverage'
import type { CoverageMapData, FileCoverageData } from 'istanbul-lib-coverage'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instrumentCoverageSource } from '../../../../../../scripts/coverage/instrumentation.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const source = [
    'export type Input = number',
    'export function branch(value: Input) {',
    '    if (value > 0) return value',
    '    return -value',
    '}',
    'export const arrows = [() => 3, () => 4]',
].join('\n')

describe('source coverage instrumentation', () => {
    test('preserves original TSX coordinates and distinguishes same-line anonymous functions', () => {
        const result = instrumentCoverageSource(
            `${source}\nexport const View = () => <span>hello</span>`,
            'web/src/example.tsx',
        )
        expect(result.code).toContain('export type Input')
        expect(result.code).toContain('<span>hello</span>')
        const functions = Object.values(result.coverage.fnMap)
        const arrows = functions.filter((fn) => fn.line === 6)
        expect(arrows).toHaveLength(2)
        expect(arrows[0]?.loc.start.column).not.toBe(arrows[1]?.loc.start.column)
        expect(functions[0]?.decl.start.line).toBe(2)
        expect(Object.values(result.coverage.f)).toEqual([0, 0, 0, 0])
    })

    test('leaves type-only modules empty and rejects unsupported runtime TypeScript constructs', () => {
        const result = instrumentCoverageSource(
            'export interface Item { value: number }; export type Name = string',
            'types.ts',
        )
        expect(result.coverage.statementMap).toEqual({})
        expect(result.coverage.fnMap).toEqual({})
        for (const text of [
            'export enum Status { ready }',
            'namespace Tools { export const x = 1 }',
        ]) {
            expect(() => instrumentCoverageSource(text, 'unsupported.ts')).toThrow(
                'runtime TypeScript enums or namespaces',
            )
        }
        expect(() =>
            instrumentCoverageSource(
                'declare namespace External { type Value = number }; const label = "enum Status { ready }"',
                'supported.ts',
            ),
        ).not.toThrow()
    })

    test('merges isolated test and inherited child hits while leaving unimported sources at zero', async () => {
        const temporaryRoot = join(repositoryRoot, 'tmp', 'coverage-instrumentation-tests')
        mkdirSync(temporaryRoot, { recursive: true })
        const directory = mkdtempSync(join(temporaryRoot, 'run-'))
        if (dirname(resolve(directory)) !== resolve(temporaryRoot)) {
            throw new Error('Refusing to use an unexpected coverage fixture directory.')
        }
        const files = ['lib.tsx', 'never.ts', 'child.ts']
        const outputDirectory = join(directory, 'coverage')
        const cacheDirectory = join(directory, 'instrumented')
        const manifestPath = join(directory, 'manifest.json')
        const fixtureSources: Record<string, string> = {
            'lib.tsx': source,
            'never.ts':
                'throw new Error("Never-imported side effect executed"); export const never = () => 9',
            'child.ts':
                'import {branch} from "./lib.tsx"; if (!import.meta.main || import.meta.file !== "child.ts" || import.meta.dir.endsWith("instrumented") || branch(7) !== 7) throw new Error("child failed")',
            'a.test.ts':
                'import {test,expect} from "bun:test"; import {branch,arrows} from "./lib.tsx"; test("positive",()=>{expect(branch(1)).toBe(1);expect(arrows[0]()).toBe(3)})',
            'b.test.ts':
                'import {test,expect} from "bun:test"; import {branch,arrows} from "./lib.tsx"; test("negative",async()=>{expect(branch(-2)).toBe(2);expect(arrows[1]()).toBe(4); const child=Bun.spawn([process.execPath,"--no-env-file",import.meta.dir+"/child.ts"],{stdout:"ignore",stderr:"inherit"});expect(await child.exited).toBe(0)})',
        }
        try {
            for (const [filename, text] of Object.entries(fixtureSources)) {
                writeFileSync(join(directory, filename), text)
                if (files.includes(filename)) {
                    const cachePath = join(cacheDirectory, filename)
                    mkdirSync(dirname(cachePath), { recursive: true })
                    writeFileSync(cachePath, instrumentCoverageSource(text, filename).code)
                }
            }
            writeFileSync(
                join(directory, 'lib.tsx'),
                'throw new Error("uncached source was loaded")',
            )
            writeFileSync(
                manifestPath,
                JSON.stringify({
                    repositoryRoot: directory,
                    outputDirectory,
                    cacheDirectory,
                    files,
                }),
            )
            const environment = {
                ...process.env,
                RENTNERPROXY_COVERAGE_MANIFEST: manifestPath,
                BUN_OPTIONS: `--preload=${join(repositoryRoot, 'scripts/coverage/child-preload.ts')}`,
            }
            const run = async (arguments_: string[]) => {
                const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], {
                    cwd: directory,
                    env: environment,
                    stdout: 'pipe',
                    stderr: 'pipe',
                })
                const [stdout, stderr, status] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                    child.exited,
                ])
                expect({ status, output: status === 0 ? '' : stdout + stderr }).toEqual({
                    status: 0,
                    output: '',
                })
            }
            await run([
                'test',
                '--isolate',
                '--max-concurrency=1',
                '--preload',
                join(repositoryRoot, 'scripts/coverage/preload.ts'),
                './a.test.ts',
                './b.test.ts',
            ])
            const rawDirectory = join(outputDirectory, 'raw')
            const snapshots = readdirSync(rawDirectory).map(
                (filename) =>
                    JSON.parse(
                        readFileSync(join(rawDirectory, filename), 'utf8'),
                    ) as CoverageMapData,
            )
            expect(snapshots.length).toBeGreaterThanOrEqual(2)
            const hits = snapshots
                .map((snapshot) => snapshot['lib.tsx'] as FileCoverageData | undefined)
                .filter((coverage): coverage is FileCoverageData => Boolean(coverage))
            expect(hits.some((coverage) => coverage.f[1] === 1 && coverage.f[2] === 0)).toBe(true)
            expect(hits.some((coverage) => coverage.f[1] === 0 && coverage.f[2] === 1)).toBe(true)
            expect(snapshots.some((snapshot) => Boolean(snapshot['child.ts']))).toBe(true)
            const coverage = createCoverageMap({})
            for (const filename of files) {
                coverage.addFileCoverage(
                    instrumentCoverageSource(fixtureSources[filename]!, filename).coverage,
                )
            }
            for (const snapshot of snapshots) coverage.merge(snapshot)
            expect(coverage.fileCoverageFor('lib.tsx').toSummary().functions).toMatchObject({
                total: 3,
                covered: 3,
                pct: 100,
            })
            expect(coverage.fileCoverageFor('never.ts').toSummary().functions).toMatchObject({
                total: 1,
                covered: 0,
            })
            expect(coverage.fileCoverageFor('never.ts').toSummary().lines.covered).toBe(0)
            const previousFiles = new Set(readdirSync(rawDirectory))
            await run(['./child.ts'])
            const newFiles = readdirSync(rawDirectory).filter(
                (filename) => !previousFiles.has(filename),
            )
            expect(newFiles).toHaveLength(1)
            const childSnapshot = JSON.parse(
                readFileSync(join(rawDirectory, newFiles[0]!), 'utf8'),
            ) as CoverageMapData
            expect(childSnapshot['child.ts']).toBeDefined()
            coverage.merge(childSnapshot)
            expect(coverage.fileCoverageFor('child.ts').toSummary().lines.pct).toBe(100)
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    }, 20_000)
})
