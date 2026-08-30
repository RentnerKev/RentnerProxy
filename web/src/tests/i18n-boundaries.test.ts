import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const importScanner = new Bun.Transpiler({ loader: 'tsx' })

async function sourceFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    return (
        await Promise.all(
            entries.map(async (entry) => {
                const path = resolve(directory, entry.name)
                return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/u.test(path) ? [path] : []
            }),
        )
    ).flat()
}

async function resolveModule(source: string, specifier: string): Promise<string | null> {
    if (!specifier.startsWith('.')) return null
    const base = resolve(dirname(source), specifier)
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.json`,
        resolve(base, 'index.ts'),
        resolve(base, 'index.tsx'),
    ]
    const results = await Promise.all(
        candidates.map(async (path) => ((await Bun.file(path).exists()) ? path : null)),
    )
    return results.find((path) => path !== null) ?? null
}

describe('language boundaries', () => {
    test('public route and document imports cannot eagerly reach a locale catalog', async () => {
        const queue = [
            resolve(sourceRoot, 'routes/__root.tsx'),
            ...(await sourceFiles(resolve(sourceRoot, 'routes/_public'))),
        ]
        const visited = new Set<string>()
        const violations: string[] = []

        while (queue.length) {
            const path = queue.pop()!
            if (visited.has(path)) continue
            visited.add(path)
            if (/[\\/]language[\\/]Locales[\\/]/u.test(path)) {
                violations.push(path)
                continue
            }
            // TanStack removes server implementation imports at this transport boundary.
            if (/[\\/]server(?:Helpers)?\.ts$/u.test(path) || !/\.tsx?$/u.test(path)) continue
            // oxlint-disable-next-line no-await-in-loop -- Discover the next imports from this dependency graph node.
            const source = await readFile(path, 'utf8')
            // oxlint-disable-next-line no-await-in-loop -- Resolve this node's imports together before traversing them.
            const targets = await Promise.all(
                importScanner
                    .scanImports(source)
                    .filter((dependency) => dependency.kind !== 'dynamic-import')
                    .map((dependency) => resolveModule(path, dependency.path)),
            )
            queue.push(...targets.filter((target) => target !== null))
        }
        expect(visited.size).toBeGreaterThan(20)
        expect(violations).toEqual([])
    })

    test('importing the shared hook never initializes a locale loader', async () => {
        const script = `
            import { LANGUAGE_RESOURCE_LOADERS } from './config/language.config.ts'
            let loads = 0
            for (const language of Object.keys(LANGUAGE_RESOURCE_LOADERS)) {
                LANGUAGE_RESOURCE_LOADERS[language] = async () => { loads++; return {} }
            }
            await import('./language/useTranslationStore.ts')
            await Bun.sleep(0)
            console.log(loads)
        `
        const child = Bun.spawn([process.execPath, '-e', script], {
            cwd: sourceRoot,
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [output, errors, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(code, errors).toBe(0)
        expect(output.trim()).toBe('0')
    })

    test('keeps literal authenticated UI copy in the language catalogs', async () => {
        const roots = [
            'features/Admin',
            'features/FoundationStatus',
            'features/UserSettings',
            'layout/Components/Theme',
            'layout/Components/ApplicationShell',
            'shared/Calendar',
            'shared/Table',
            'shared/Toast',
            'shared/Modal',
            'shared/Select',
            'shared/Avatar',
            'shared/Forms',
            'layout/Components/SystemStatePage',
        ]
        const files = (
            await Promise.all(roots.map((root) => sourceFiles(resolve(sourceRoot, root))))
        ).flat()
        const literalAttribute =
            /\b(?:aria-label|placeholder|alt|title|description|eyebrow|label|confirmLabel|cancelLabel|pendingLabel|loadingLabel|searchLabel|searchPlaceholder|itemLabel)\s*=\s*["']([^"']+)["']/gu
        const literalChild = /<[A-Za-z][\w.]*(?:\s+[^<>]*?)?(?<!\/)>([^<>{]*\p{L}[^<>{}]*)</gu
        const violations: string[] = []
        const sources = await Promise.all(
            files
                .filter((file) => file.endsWith('.tsx'))
                .map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        for (const { path, source } of sources) {
            for (const match of [
                ...source.matchAll(literalAttribute),
                ...source.matchAll(literalChild),
            ]) {
                const text = match[1]?.trim() ?? ''
                if (!/\p{L}/u.test(text)) continue
                if (
                    /^(?:account|admin|common|language|theme|foundation|system|shell|validation)\.[\w.]+$/u.test(
                        text,
                    )
                )
                    continue
                const line = source.slice(0, match.index).split('\n').length
                violations.push(`${path}:${line}: ${text}`)
            }
        }
        expect(violations).toEqual([])
    })
})
