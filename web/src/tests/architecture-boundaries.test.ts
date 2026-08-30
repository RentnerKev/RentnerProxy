import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const serverRoot = resolve(sourceRoot, 'server')
const databaseRoot = resolve(sourceRoot, 'db')
const clientRoots = ['features', 'layout', 'routes', 'shared'].map((directory) =>
    resolve(sourceRoot, directory),
)
const renderingRoots = ['features', 'integrations', 'layout', 'routes', 'shared'].map((directory) =>
    resolve(sourceRoot, directory),
)
const importPattern = /(?:from\s*|import\s*)['"]([^'"]+)['"]/g
const permissionLiteralPattern =
    /['"](?:app\.access|users\.(?:view|create|update|disable|assign_roles)|roles\.(?:view|create|update|delete|assign_permissions)|account\.(?:view|update))['"]/g
const renderingLogicPattern =
    /\b(?:useCallback|useEffect|useForm|useId|useMatch|useMemo|useMutation|useNavigate|useQuery|useReactTable|useReducer|useRef|useRouter|useSearch|useState|useSuspenseQuery)\s*\(/
const nativeTitleAttributePattern = /<[a-z][\w.-]*\b[^>]*\btitle\s*=/s

function isTypeScriptFile(path: string): boolean {
    return ['.ts', '.tsx'].includes(extname(path))
}

function isInside(path: string, root: string): boolean {
    return path === root || path.startsWith(`${root}${sep}`)
}

async function collectFiles(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true })
    const nested = await Promise.all(
        entries.map(async (entry) => {
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
            .filter((path) => !['server.ts', 'serverHelpers.ts'].includes(path.split(sep).at(-1)!))
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations: string[] = []

        for (const { path, source } of sources) {
            for (const match of source.matchAll(importPattern)) {
                const specifier = match[1]

                if (!specifier?.startsWith('.')) {
                    continue
                }

                const target = resolve(dirname(path), specifier)

                if (isInside(target, serverRoot) || isInside(target, databaseRoot)) {
                    violations.push(`${path}: ${specifier}`)
                }
            }
        }

        expect(violations).toEqual([])
    })

    test('keeps every createServerFn transport boundary in a feature server.ts', async () => {
        const roots = ['features', 'layout', 'routes', 'server'].map((directory) =>
            resolve(sourceRoot, directory),
        )
        const files = (await Promise.all(roots.map(collectFiles))).flat().filter(isTypeScriptFile)
        const sources = await Promise.all(
            files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
        )
        const violations: string[] = []

        for (const { path, source } of sources) {
            if (
                source.includes('createServerFn(') &&
                !(
                    isInside(path, resolve(sourceRoot, 'features')) &&
                    path.endsWith(`${sep}server.ts`)
                )
            ) {
                violations.push(path)
            }
        }

        expect(violations).toEqual([])
    })

    test('uses the permission registry instead of scattered runtime literals', async () => {
        const roots = ['features', 'layout', 'routes', 'server', 'shared'].map((directory) =>
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
        const source = await readFile(resolve(sourceRoot, 'shared/Types/auth.types.ts'), 'utf8')

        expect(source).not.toMatch(/password|token|hash/i)
    })

    test('keeps mail delivery behind business services', async () => {
        const forgotPasswordServer = await readFile(
            resolve(sourceRoot, 'features/Auth/ForgotPassword/server.ts'),
            'utf8',
        )
        const userManagementServer = await readFile(
            resolve(sourceRoot, 'features/Admin/UserManagement/server.ts'),
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
        const viteConfig = await readFile(resolve(sourceRoot, '../vite.config.ts'), 'utf8')

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

    test('uses shared tooltips instead of native title attributes', async () => {
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
