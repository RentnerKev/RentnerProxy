import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'

export function assertHistoricalImports(
    source: string,
    repositoryPath: string,
    availablePaths: readonly string[],
): void {
    const imports = source.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)(['"])([^'"\r\n]+)\1/gu)
    for (const match of imports) {
        const specifier = match[2]!
        if (specifier.startsWith('node:') || specifier === 'bun' || specifier === 'zod') continue
        if (specifier.startsWith('.')) {
            const dependency = posix.normalize(posix.join(posix.dirname(repositoryPath), specifier))
            if (availablePaths.includes(dependency)) continue
        }
        throw new Error('unsupported historical tool import')
    }
}

export async function copyHistoricalZod(installedPackage: string, historicalRoot: string) {
    const metadata = JSON.parse(await readFile(join(installedPackage, 'package.json'), 'utf8')) as {
        readonly name?: unknown
    }
    if (metadata.name !== 'zod') throw new Error('historical Zod dependency unavailable')
    const destination = join(historicalRoot, 'node_modules', 'zod')
    await mkdir(dirname(destination), { recursive: true })
    await cp(installedPackage, destination, {
        recursive: true,
        dereference: true,
        force: false,
        errorOnExist: true,
    })
    return destination
}
