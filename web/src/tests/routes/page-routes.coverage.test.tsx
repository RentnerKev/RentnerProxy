import { expect, mock, test } from 'bun:test'
import type { ReactElement } from 'react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'

type Options = {
    component?: () => ReactElement | null
    beforeLoad?: (input: unknown) => unknown
    loader?: (input: unknown) => unknown
    validateSearch?: (search: Record<string, unknown>) => unknown
    head?: () => unknown
    shellComponent?: unknown
}
const registry = new Map<string, Options>()
const user: AuthenticatedUser = {
    id: 'fixture-user',
    displayName: 'Fixture',
    email: 'fixture@example.com',
    profileImageVersion: null,
    roles: ['owner'],
    permissions: Object.values(PERMISSIONS),
    language: 'en',
    themeMode: 'dark',
}
const search = {
    downloadError: 'permission_denied',
    selectedCertificateId: '0198d98a-0000-7000-8000-000000000001',
}
const bootstrap = { language: 'en', resources: {} }
const loadLanguage = mock(async (_language: string) => bootstrap)
const provider = () => null
const outlet = () => null
mock.module('@tanstack/react-router', () => ({
    createFileRoute: (path: string) => (options: Options) => {
        registry.set(path, options)
        return {
            options,
            useRouteContext: () => ({ user }),
            useSearch: () => search,
            useLoaderData: () => bootstrap,
        }
    },
    createRootRoute: (options: Options) => {
        registry.set('__root__', options)
        return { options }
    },
    redirect: (options: { to: string }) => new Error(`redirect:${options.to}`),
    Outlet: outlet,
}))
mock.module('@/features/Auth/middleware.ts', () => ({
    getAuthStateHandler: mock(async () => ({ user, setupRequired: false, sessionId: 'session' })),
    logoutHandler: mock(async () => ({ success: true })),
}))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    AuthenticatedLanguageProvider: provider,
    loadLanguageBootstrap: loadLanguage,
}))
mock.module('@/features/UserSettings/Hooks/useUserSettingsRoute.ts', () => ({
    default: () => ({ user, activeSection: 'password' }),
}))
const ddnsApi = { fixture: 'ddns' }
const discoveryApi = { fixture: 'discovery' }
mock.module('@/features/Admin/Ddns/ddns-api.ts', () => ({ ddnsApi }))
mock.module('@/features/Admin/DockerDiscovery/discovery-api.ts', () => ({ discoveryApi }))
mock.module('@/styles.css', () => ({}))

const matrix: {
    source: string
    path: string
    page: string
    props?: Record<string, unknown>
    permission?: boolean
    direct?: boolean
}[] = [
    {
        source: '_authenticated/access-policies.tsx',
        path: '/_authenticated/access-policies',
        page: 'Admin/AccessPolicyManagement/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/account.tsx',
        path: '/_authenticated/account',
        page: 'UserSettings/index.tsx',
        props: { user, activeSection: 'password' },
        permission: true,
    },
    {
        source: '_authenticated/audit-logs.tsx',
        path: '/_authenticated/audit-logs',
        page: 'Admin/AuditLogs/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/backups.tsx',
        path: '/_authenticated/backups',
        page: 'Admin/Backups/index.tsx',
        props: {
            userId: user.id,
            permissions: user.permissions,
            downloadError: search.downloadError,
        },
        permission: true,
    },
    {
        source: '_authenticated/certificates.tsx',
        path: '/_authenticated/certificates',
        page: 'Admin/CertificateManagement/index.tsx',
        props: {
            permissions: user.permissions,
            selectedCertificateId: search.selectedCertificateId,
        },
        permission: true,
    },
    {
        source: '_authenticated/crowdsec.tsx',
        path: '/_authenticated/crowdsec',
        page: 'Admin/CrowdSec/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/ddns.tsx',
        path: '/_authenticated/ddns',
        page: 'Admin/Ddns/index.tsx',
        props: { permissions: user.permissions, api: ddnsApi },
        permission: true,
    },
    {
        source: '_authenticated/docker-discovery.tsx',
        path: '/_authenticated/docker-discovery',
        page: 'Admin/DockerDiscovery/index.tsx',
        props: { permissions: user.permissions, api: discoveryApi },
        permission: true,
    },
    {
        source: '_authenticated/identity-providers.tsx',
        path: '/_authenticated/identity-providers',
        page: 'Admin/OidcProviders/index.tsx',
        direct: true,
    },
    {
        source: '_authenticated/index.tsx',
        path: '/_authenticated/',
        page: 'FoundationStatus/index.tsx',
    },
    {
        source: '_authenticated/migration.tsx',
        path: '/_authenticated/migration',
        page: 'Admin/Migration/MigrationPage.tsx',
        permission: true,
        direct: true,
    },
    {
        source: '_authenticated/npm-import.tsx',
        path: '/_authenticated/npm-import',
        page: 'Admin/NpmImport/NpmImportPage.tsx',
        permission: true,
        direct: true,
    },
    {
        source: '_authenticated/operations.tsx',
        path: '/_authenticated/operations',
        page: 'DefaultSite/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/providers.tsx',
        path: '/_authenticated/providers',
        page: 'Admin/DnsConnections/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/proxy-access-logs.tsx',
        path: '/_authenticated/proxy-access-logs',
        page: 'Admin/ProxyAccessLogs/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/proxy-hosts.tsx',
        path: '/_authenticated/proxy-hosts',
        page: 'Admin/ProxyHostManagement/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/redirect-hosts.tsx',
        path: '/_authenticated/redirect-hosts',
        page: 'Admin/RedirectHostManagement/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/roles.tsx',
        path: '/_authenticated/roles',
        page: 'Admin/RoleManagement/index.tsx',
        props: { permissions: user.permissions, currentUserRoleKeys: user.roles },
        permission: true,
    },
    {
        source: '_authenticated/security.tsx',
        path: '/_authenticated/security',
        page: 'Admin/CrowdSec/Components/SecurityDashboardPage/index.tsx',
        permission: true,
    },
    {
        source: '_authenticated/users.tsx',
        path: '/_authenticated/users',
        page: 'Admin/UserManagement/index.tsx',
        props: {
            currentUserId: user.id,
            currentUserRoleKeys: user.roles,
            permissions: user.permissions,
        },
        permission: true,
    },
    {
        source: '_public/accept-invite.tsx',
        path: '/_public/accept-invite',
        page: 'Auth/AcceptInvite/index.tsx',
        direct: true,
    },
    {
        source: '_public/forgot-password.tsx',
        path: '/_public/forgot-password',
        page: 'Auth/ForgotPassword/index.tsx',
        direct: true,
    },
    {
        source: '_public/login.index.tsx',
        path: '/_public/login/',
        page: 'Auth/Login/index.tsx',
        direct: true,
    },
    {
        source: '_public/login.two-factor.tsx',
        path: '/_public/login/two-factor',
        page: 'Auth/Login/Components/TwoFactorLoginPage.tsx',
        direct: true,
    },
    {
        source: '_public/reset-password.tsx',
        path: '/_public/reset-password',
        page: 'Auth/PasswordReset/index.tsx',
        direct: true,
    },
    {
        source: '_public/setup.tsx',
        path: '/_public/setup',
        page: 'Auth/Setup/index.tsx',
        direct: true,
    },
]
const pages = new Map<string, () => null>()
for (const { page } of matrix) {
    const component = mock(() => null)
    pages.set(page, component)
    mock.module(`@/features/${page}`, () => ({ default: component }))
}
const authenticatedLayout = () => null
const publicLayout = () => null
const rootLayout = () => null
const document = () => null
mock.module('@/layouts/AuthenticatedLayout/index.tsx', () => ({ default: authenticatedLayout }))
mock.module('@/layouts/PublicLayout/index.tsx', () => ({ default: publicLayout }))
mock.module('@/layouts/RootLayout/index.tsx', () => ({ default: rootLayout }))
mock.module('@/layouts/RootDocument/index.tsx', () => ({ default: document }))
await Promise.all(
    [
        ...matrix.map(({ source }) => source),
        '_authenticated/dns-connections.tsx',
        '_authenticated/route.tsx',
        '_public/route.tsx',
        '_public/login.tsx',
        '__root.tsx',
    ].map((source) => import(`@/routes/${source}`)),
)

test.each(matrix)('$path binds its intended page and authenticated props', async (entry) => {
    const config = registry.get(entry.path)
    if (!config?.component) throw new Error(`Missing route ${entry.path}`)
    if (entry.permission) {
        expect(() =>
            config.beforeLoad?.({ context: { user: { ...user, permissions: [] } } }),
        ).toThrow('redirect:/')
        expect(await config.beforeLoad?.({ context: { user } })).toBeUndefined()
    }
    if (entry.direct) expect(Object.is(config.component, pages.get(entry.page))).toBe(true)
    else {
        const element = config.component()
        if (!element) throw new Error('Page wrapper returned no element')
        expect(element.type).toBe(pages.get(entry.page)!)
        expect(element.props).toEqual(entry.props ?? { permissions: user.permissions })
    }
})

test('special route guards enforce combined privileges, legacy redirects and strict search contracts', async () => {
    const context = { context: { user } }
    const owner = registry.get('/_authenticated/identity-providers')!
    expect(() => owner.beforeLoad!({ context: { user: { ...user, roles: [] } } })).toThrow(
        'redirect:/',
    )
    expect(owner.beforeLoad!(context)).toBeUndefined()
    await expect(
        Promise.resolve().then(() =>
            registry.get('/_authenticated/dns-connections')!.beforeLoad!(context),
        ),
    ).rejects.toThrow('redirect:/providers')
    await expect(
        Promise.resolve().then(() =>
            registry.get('/_authenticated/dns-connections')!.beforeLoad!({
                context: { user: { ...user, permissions: [] } },
            }),
        ),
    ).rejects.toThrow('redirect:/')
    expect(() =>
        registry.get('/_authenticated/docker-discovery')!.beforeLoad!({
            context: { user: { ...user, permissions: [PERMISSIONS.DOCKER_DISCOVERY_VIEW] } },
        }),
    ).toThrow('redirect:/')
    expect(
        registry.get('/_authenticated/certificates')!.beforeLoad!({
            context: { user: { ...user, permissions: [PERMISSIONS.TRUSTED_CAS_VIEW] } },
        }),
    ).toBeUndefined()
    expect(
        registry.get('/_authenticated/certificates')!.beforeLoad!({
            context: { user: { ...user, permissions: [PERMISSIONS.CERTIFICATES_VIEW] } },
        }),
    ).toBeUndefined()
    expect(
        registry.get('/_authenticated/account')!.validateSearch!({ section: 'passkeys' }),
    ).toEqual({ section: 'passkeys' })
    expect(
        registry.get('/_authenticated/account')!.validateSearch!({ section: 'untrusted' }),
    ).toEqual({ section: 'profile' })
    expect(
        registry.get('/_authenticated/backups')!.validateSearch!({
            downloadError: 'permission_denied',
        }),
    ).toEqual({ downloadError: 'permission_denied' })
    expect(() =>
        registry.get('/_authenticated/certificates')!.validateSearch!({
            selectedCertificateId: '../invalid',
        }),
    ).toThrow()
    expect(
        registry.get('/_authenticated/certificates')!.validateSearch!({
            selectedCertificateId: search.selectedCertificateId,
        }),
    ).toEqual({ selectedCertificateId: search.selectedCertificateId })
    expect(
        registry.get('/_public/login/')!.validateSearch!({
            oidcError: 'failed',
            unsafe: 'ignored',
        }),
    ).toEqual({ oidcError: 'failed' })
    expect(
        registry.get('/_public/login/')!.validateSearch!({ oidcError: 'user-controlled-message' }),
    ).toEqual({})
})

test('layout routes load user language, retain keyed authenticated layout and sanitize root CSP context', async () => {
    const authenticated = registry.get('/_authenticated')!
    expect(await authenticated.beforeLoad!({})).toEqual({ user, sessionId: 'session' })
    expect(await authenticated.loader!({ context: { user } })).toBe(bootstrap)
    expect(loadLanguage).toHaveBeenCalledWith('en')
    const element = authenticated.component!()
    if (!element) throw new Error('Authenticated layout returned no element')
    expect(element.type).toBe(provider)
    expect(element.key).toBe(user.id)
    expect(element.props).toMatchObject({
        bootstrap,
        children: { type: authenticatedLayout, props: { user } },
    })
    expect(registry.get('/_public')!.component).toBe(publicLayout)
    expect(registry.get('/_public/login')!.component).toBe(outlet)
    const root = registry.get('__root__')!
    expect(root.component).toBe(rootLayout)
    expect(root.shellComponent).toBe(document)
    expect(root.head!()).toMatchObject({
        links: [{ rel: 'icon', type: 'image/png', href: '/rentnerproxy-logo.png' }],
    })
    expect(root.beforeLoad!({ serverContext: { cspNonce: 'A'.repeat(24) } })).toEqual({
        cspNonce: 'A'.repeat(24),
    })
    expect(root.beforeLoad!({ serverContext: { cspNonce: 'bad nonce' } })).toEqual({})
    expect(root.beforeLoad!(null)).toEqual({})
    expect(root.beforeLoad!({ serverContext: 'invalid' })).toEqual({})
})
