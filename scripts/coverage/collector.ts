import { plugin } from 'bun'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve } from 'node:path'
import type { CoverageGlobal, CoverageManifest } from './Types/instrumentation.types.ts'
function readCoverageManifest(path: string): CoverageManifest {
    if (!isAbsolute(path)) throw new Error('Coverage manifest path must be absolute.')
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object') throw new Error('Invalid coverage manifest.')
    const manifest = value as Record<string, unknown>
    if (
        typeof manifest.repositoryRoot !== 'string' ||
        !isAbsolute(manifest.repositoryRoot) ||
        typeof manifest.cacheDirectory !== 'string' ||
        !isAbsolute(manifest.cacheDirectory) ||
        typeof manifest.outputDirectory !== 'string' ||
        !isAbsolute(manifest.outputDirectory) ||
        !Array.isArray(manifest.files) ||
        !manifest.files.every(
            (file: unknown) =>
                typeof file === 'string' &&
                !isAbsolute(file) &&
                !file.includes('\\') &&
                !file.split('/').some((part) => part === '..' || part === '.' || part === '') &&
                /\.tsx?$/u.test(file),
        )
    ) {
        throw new Error('Invalid coverage manifest paths or files.')
    }
    return manifest as CoverageManifest
}

export function installCoverageCollector(): boolean {
    const globals = globalThis as CoverageGlobal
    if (globals.rentnerproxyCoverageCollector) return true
    const manifestPath = process.env.RENTNERPROXY_COVERAGE_MANIFEST
    if (!manifestPath) return false
    const manifest = readCoverageManifest(manifestPath)
    const eligibleFiles = new Map(
        manifest.files.map((file) => [normalize(resolve(manifest.repositoryRoot, file)), file]),
    )
    if (eligibleFiles.size > 0) {
        // Bun runtime onLoad requires an object even for non-matches. Register only exact paths.
        const filter = new RegExp(
            `^(?:${[...eligibleFiles.keys()]
                .map((path) => path.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
                .join('|')})$`,
        )
        plugin({
            name: 'rentnerproxy-coverage',
            setup(build) {
                build.onLoad({ filter }, ({ path }) => {
                    const filename = eligibleFiles.get(normalize(path))
                    if (!filename) throw new Error('Unexpected coverage loader path.')
                    return {
                        contents: readFileSync(join(manifest.cacheDirectory, filename), 'utf8'),
                        loader: filename.endsWith('.tsx') ? 'tsx' : 'ts',
                    }
                })
            },
        })
    }
    globals.rentnerproxyCoverageCollector = { manifest }
    return true
}

export function writeCoverageSnapshot(): void {
    const globals = globalThis as CoverageGlobal
    const state = globals.rentnerproxyCoverageCollector
    if (!state) return
    const rawDirectory = join(state.manifest.outputDirectory, 'raw')
    mkdirSync(rawDirectory, { recursive: true })
    const snapshot = Object.fromEntries(
        Object.entries(globals.rentnerproxyCoverage ?? {}).filter(([filename]) =>
            state.manifest.files.includes(filename),
        ),
    )
    writeFileSync(
        join(rawDirectory, `${process.pid}-${randomUUID()}.json`),
        JSON.stringify(snapshot),
    )
}
