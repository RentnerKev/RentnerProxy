import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url))
const serverRoot = resolve(sourceRoot, 'server')
const databaseRoot = resolve(sourceRoot, 'db')
const clientRoots = ['features', 'layouts', 'routes', 'shared'].map((directory) =>
    resolve(sourceRoot, directory),
)
const permissionLiteralPattern =
    /['"](?:app\.access|proxy_hosts\.(?:view|create|update|delete|enable|disable|apply)|users\.(?:view|create|update|disable|enable|assign_roles)|roles\.(?:view|create|update|delete|assign_permissions)|account\.(?:view|update))['"]/g

function isTypeScriptFile(path: string): boolean {
    return ['.ts', '.tsx'].includes(extname(path))
}

function isInside(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}${sep}`)
}

function resolveLocalImport(importer: string, specifier: string): string | null {
    if (specifier.startsWith('@/')) return resolve(sourceRoot, specifier.slice(2))
    if (specifier.startsWith('.')) return resolve(dirname(importer), specifier)
    return null
}

function isRawApiRoute(path: string): boolean {
    return isInside(path, resolve(sourceRoot, 'routes/api')) && extname(path) === '.ts'
}

async function collectFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true })
    const nested = await Promise.all(
        entries.map(async (entry) => {
            if (entry.name === 'drizzle') return []
            const path = resolve(root, entry.name)
            return entry.isDirectory() ? collectFiles(path) : [path]
        }),
    )

    return nested.flat()
}

describe('web architecture boundaries', () => {
    test('keeps server and database implementations out of client modules', async () => {
        const files = (await Promise.all(clientRoots.map(collectFiles)))
            .flat()
            .filter(isTypeScriptFile)
            .filter(
                (path) =>
                    !(
                        isInside(path, resolve(sourceRoot, 'features')) &&
                        basename(path) === 'middleware.ts'
                    ),
            )
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations: string[] = []

        for (const { path, source } of sources) {
            // Raw API routes execute in Start's server handler graph; their imported service
            // must still be wrapped in an explicit server-only adapter before delegation.
            if (isRawApiRoute(path) && /\bcreateServerOnlyFn\s*\(/.test(source)) continue
            const transpiler = new Bun.Transpiler({
                loader: extname(path) === '.tsx' ? 'tsx' : 'ts',
            })
            for (const { path: specifier } of transpiler.scanImports(source)) {
                const target = resolveLocalImport(path, specifier)
                if (!target) continue

                if (isInside(target, serverRoot) || isInside(target, databaseRoot)) {
                    violations.push(`${path}: ${specifier}`)
                }
            }
        }

        expect(violations).toEqual([])
    })

    test('keeps Server Functions in feature middleware and raw API adapters on the server', async () => {
        const roots = ['features', 'layouts', 'routes', 'server'].map((directory) =>
            resolve(sourceRoot, directory),
        )
        const files = (await Promise.all(roots.map(collectFiles))).flat().filter(isTypeScriptFile)
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations: string[] = []

        for (const { path, source } of sources) {
            const featureAdapter =
                isInside(path, resolve(sourceRoot, 'features')) &&
                path.endsWith(`${sep}middleware.ts`)
            if (/\bcreateServerFn\s*\(/.test(source) && !featureAdapter) violations.push(path)
            if (
                /\bcreateServerOnlyFn\s*\(/.test(source) &&
                !featureAdapter &&
                !isRawApiRoute(path)
            ) {
                violations.push(path)
            }
            if (featureAdapter) {
                for (const match of source.matchAll(
                    /export const (\w+)\s*=\s*createServer(?:Fn|OnlyFn)\s*\(/g,
                )) {
                    if (!match[1]?.endsWith('Handler')) violations.push(`${path}: ${match[1]}`)
                }
            }
        }

        expect(violations).toEqual([])
    })

    test('uses the permission registry instead of scattered runtime literals', async () => {
        const roots = ['features', 'layouts', 'routes', 'server', 'shared'].map((directory) =>
            resolve(sourceRoot, directory),
        )
        const files = (await Promise.all(roots.map(collectFiles))).flat().filter(isTypeScriptFile)
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations: string[] = []

        for (const { path, source } of sources) {
            const matches = source.match(permissionLiteralPattern)

            if (matches) {
                violations.push(`${path}: ${matches.join(', ')}`)
            }
        }

        expect(violations).toEqual([])
    })

    test('keeps client-safe auth types free of credentials and tokens', async () => {
        const source = await readFile(resolve(sourceRoot, 'lib/Auth/Types/auth.types.ts'), 'utf8')

        expect(source).not.toMatch(/password|token|hash/i)
    })

    test('protects server, service, and database imports in the Vite client graph', async () => {
        const viteConfig = await readFile(resolve(sourceRoot, '../../vite.config.ts'), 'utf8')

        expect(viteConfig).toContain("'**/*.server.*'")
        expect(viteConfig).toContain("'**/*.service.*'")
        expect(viteConfig).toContain("'**/server/**'")
        expect(viteConfig).toContain("'**/db/**'")
    })
})
