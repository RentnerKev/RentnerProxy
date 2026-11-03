import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** Preserve original counter locations when testing a sandboxed copy of a filesystem CLI. */
export async function coverageFixtureSource(filename: string): Promise<string> {
    if (
        isAbsolute(filename) ||
        filename.includes('\\') ||
        filename.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) {
        throw new Error('Invalid coverage fixture source path.')
    }
    const manifestPath = process.env.RENTNERPROXY_COVERAGE_MANIFEST
    if (manifestPath) {
        const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
        if (!manifest || typeof manifest !== 'object') throw new Error('Invalid coverage manifest.')
        const value = manifest as Record<string, unknown>
        if (
            typeof value.repositoryRoot !== 'string' ||
            normalize(resolve(value.repositoryRoot)) !== normalize(resolve(repositoryRoot)) ||
            typeof value.cacheDirectory !== 'string' ||
            !isAbsolute(value.cacheDirectory) ||
            !Array.isArray(value.files) ||
            !value.files.includes(filename)
        ) {
            throw new Error('Coverage fixture source is missing from the current registry.')
        }
        return readFile(join(value.cacheDirectory, filename), 'utf8')
    }
    return readFile(join(repositoryRoot, filename), 'utf8')
}

export async function copyCoverageFixtureModules(
    directory: string,
    filenames: string[],
    replacements: Readonly<Record<string, string>>,
): Promise<void> {
    await mkdir(directory, { recursive: true })
    await symlink(
        join(repositoryRoot, 'node_modules'),
        join(directory, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
    )
    await Promise.all(
        filenames.map(async (filename) => {
            let source = await coverageFixtureSource(filename)
            for (const [original, target] of Object.entries(replacements))
                source = source.replaceAll(original, target)
            source = source.replace(
                /((?:from|import)\s*['"])(\.[^'"]+)(['"])/gu,
                (_match: string, before: string, specifier: string, after: string) => {
                    const target = resolve(repositoryRoot, dirname(filename), specifier)
                    const ownPath = relative(repositoryRoot, target).replaceAll('\\', '/')
                    return (
                        before +
                        pathToFileURL(
                            filenames.includes(ownPath) ? join(directory, ownPath) : target,
                        ).href +
                        after
                    )
                },
            )
            const target = join(directory, filename)
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, source)
        }),
    )
}
