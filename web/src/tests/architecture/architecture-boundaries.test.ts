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
const renderingRoots = ['features', 'integrations', 'layouts', 'routes', 'shared'].map(
    (directory) => resolve(sourceRoot, directory),
)
const permissionLiteralPattern =
    /['"](?:app\.access|proxy_hosts\.(?:view|create|update|delete|enable|disable|apply)|users\.(?:view|create|update|disable|enable|assign_roles)|roles\.(?:view|create|update|delete|assign_permissions)|account\.(?:view|update))['"]/g
const renderingLogicPattern =
    /\b(?:useCallback|useEffect|useForm|useId|useMatch|useMemo|useMutation|useNavigate|useQuery|useReactTable|useReducer|useRef|useRouter|useSearch|useState|useSuspenseQuery)\s*\(/
const nativeTitleAttributePattern = /<[a-z][\w.-]*\b[^>]*\btitle\s*=/s

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
    test('keeps state, query, form, table, and router logic out of TSX rendering modules', async () => {
        const files = (await Promise.all(renderingRoots.map(collectFiles)))
            .flat()
            .filter((path) => extname(path) === '.tsx')
            .filter((path) => !path.endsWith(`${sep}routeTree.gen.tsx`))
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations = sources
            .filter(({ source }) => renderingLogicPattern.test(source))
            .map(({ path }) => path)

        expect(violations).toEqual([])
    })

    test('keeps hook implementations in TypeScript modules instead of TSX modules', async () => {
        const files = (await Promise.all(renderingRoots.map(collectFiles))).flat()
        const violations = files.filter(
            (path) => extname(path) === '.tsx' && path.split(sep).includes('Hooks'),
        )

        expect(violations).toEqual([])
    })

    test('uses direct Lucide components instead of handwritten icon modules', async () => {
        const files = (await Promise.all(renderingRoots.map(collectFiles)))
            .flat()
            .filter((path) => extname(path) === '.tsx')
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const handwrittenSvgFiles = sources
            .filter(({ source }) => source.includes('<svg'))
            .map(({ path }) => path)
        const iconModuleFiles = files.filter((path) => /Icons?\.tsx$/i.test(basename(path)))
        const broadLucideImportFiles = sources
            .filter(({ source }) =>
                /import\s+\*\s+as\s+\w+\s+from\s+['"]lucide-react['"]|\bDynamicIcon\b/.test(source),
            )
            .map(({ path }) => path)

        expect({ broadLucideImportFiles, handwrittenSvgFiles, iconModuleFiles }).toEqual({
            broadLucideImportFiles: [],
            handwrittenSvgFiles: [],
            iconModuleFiles: [],
        })
    })

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

    test('keeps configuration declarative and runtime helpers with their owners', async () => {
        const files = (await collectFiles(resolve(sourceRoot, 'config'))).filter(isTypeScriptFile)
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations: string[] = []
        for (const { path, source } of sources) {
            if (path.split(sep).includes('Types')) {
                if (new Bun.Transpiler({ loader: 'ts' }).transformSync(source).trim()) {
                    violations.push(path)
                }
                continue
            }
            const imports = new Bun.Transpiler({ loader: 'ts' }).scanImports(source)
            // Strip comments and display strings so CSS functions and prose are not treated as code.
            const code = source.replace(
                /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
                '',
            )
            if (
                imports.length > 0 ||
                /\b(?:function|class|new|await)\b|=>|\b[\w$]+(?:\.[\w$]+)*\s*\(/.test(code)
            ) {
                violations.push(path)
            }
        }
        expect(violations).toEqual([])
    })

    test('keeps feature helpers and key-only modules out of feature trees', async () => {
        const files = await collectFiles(resolve(sourceRoot, 'features'))
        expect(files.filter((path) => path.split(sep).includes('Helpers'))).toEqual([])
        expect(files.filter((path) => basename(path) === 'queryKeys.ts')).toEqual([])
    })

    test('keeps generic helper and compatibility wrapper paths out of shared source', async () => {
        const files = await collectFiles(resolve(sourceRoot, 'shared'))
        expect(files.filter((path) => path.split(sep).includes('Helpers'))).toEqual([])
    })

    test('keeps client-safe auth types free of credentials and tokens', async () => {
        const source = await readFile(resolve(sourceRoot, 'lib/Auth/Types/auth.types.ts'), 'utf8')

        expect(source).not.toMatch(/password|token|hash/i)
    })

    test('keeps mail delivery behind business services', async () => {
        const forgotPasswordServer = await readFile(
            resolve(sourceRoot, 'features/Auth/ForgotPassword/middleware.ts'),
            'utf8',
        )
        const userManagementServer = await readFile(
            resolve(sourceRoot, 'features/Admin/UserManagement/middleware.ts'),
            'utf8',
        )
        const passwordResetService = await readFile(
            resolve(sourceRoot, 'server/Auth/PasswordReset/password-reset.service.ts'),
            'utf8',
        )
        const usersService = await readFile(
            resolve(sourceRoot, 'server/Admin/UserManagement/users.service.ts'),
            'utf8',
        )

        expect(forgotPasswordServer).not.toContain('/mail/')
        expect(userManagementServer).not.toContain('/mail/')
        expect(passwordResetService).toContain('sendPasswordResetEmailService')
        expect(usersService).toContain('sendUserInviteEmailService')
    })

    test('protects server, service, and database imports in the Vite client graph', async () => {
        const viteConfig = await readFile(resolve(sourceRoot, '../../vite.config.ts'), 'utf8')

        expect(viteConfig).toContain("'**/*.server.*'")
        expect(viteConfig).toContain("'**/*.service.*'")
        expect(viteConfig).toContain("'**/server/**'")
        expect(viteConfig).toContain("'**/db/**'")
    })

    test('keeps component styling in Tailwind utilities', async () => {
        const stylesheet = await readFile(resolve(sourceRoot, 'styles.css'), 'utf8')

        expect(stylesheet).toContain('@theme inline')
        expect(stylesheet).toContain('@custom-variant dark')
        expect(stylesheet).not.toMatch(/^\s*\.[a-z][\w-]*/m)
    })

    test('uses package tooltips instead of native title attributes', async () => {
        const files = (await Promise.all(renderingRoots.map(collectFiles)))
            .flat()
            .filter((path) => extname(path) === '.tsx')
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations = sources
            .filter(({ source }) => nativeTitleAttributePattern.test(source))
            .map(({ path }) => path)

        expect(violations).toEqual([])
    })
})
