import { expect, mock, test } from 'bun:test'

type HttpHandler = ReturnType<typeof endpoint>
function endpoint(name: string) {
    return mock(
        async (..._arguments: unknown[]) =>
            new Response(name, { status: 202, headers: { 'x-fixture-handler': name } }),
    )
}
const backups = Object.fromEntries(
    ['configure', 'delete', 'configureOffHost', 'restore', 'start', 'status'].map((name) => [
        name,
        endpoint(`backup:${name}`),
    ]),
)
const monitoring = Object.fromEntries(
    ['history', 'policy', 'summary'].map((name) => [name, endpoint(`monitoring:${name}`)]),
)
const oidc = { start: endpoint('oidc:start'), callback: endpoint('oidc:callback') }
const download = endpoint('backup:download')
const diagnose = endpoint('diagnose')
const providers = endpoint('providers')
const providerTest = endpoint('provider:test')
const connections = endpoint('connections')
const snapshot = endpoint('snapshot')
const migrationGet = endpoint('migration:get')
const migrationPost = endpoint('migration:post')
const migrationExport = endpoint('migration:export')
const npmGet = endpoint('npm:get')
const npmPost = endpoint('npm:post')
const avatar = endpoint('avatar')
const logo = endpoint('logo')
let ready = false
mock.module('@tanstack/react-start', () => ({
    createServerOnlyFn: (callback: unknown) => callback,
}))
mock.module('@/server/Admin/Backups/backups-response.server.ts', () => ({
    backupsHttpHandlers: backups,
}))
mock.module('@/server/Admin/Backups/backups-download-response.server.ts', () => ({
    backupDownloadHttpHandler: download,
}))
mock.module('@/server/RuntimeDiagnostics/domain-diagnostics-response.server.ts', () => ({
    handleDomainDiagnosticsPost: diagnose,
}))
mock.module('@/server/HostMonitoring/host-monitoring-response.server.ts', () => ({
    hostMonitoringHttpHandlers: monitoring,
}))
mock.module('@/server/Auth/Oidc/oidc-provider-response.server.ts', () => ({
    handleOidcProviderRequest: providers,
}))
mock.module('@/server/Auth/Oidc/oidc-provider-test-response.server.ts', () => ({
    handleOidcProviderTestRequest: providerTest,
}))
mock.module('@/server/Auth/Oidc/oidc-response.server.ts', () => ({ oidcHttpHandlers: oidc }))
mock.module('@/server/Auth/Oidc/oidc-connections-response.server.ts', () => ({
    handleOidcConnectionsRequest: connections,
}))
mock.module('@/server/WebSockets/realtimeSnapshots.service.ts', () => ({
    getLiveSnapshotResponse: snapshot,
}))
mock.module('@/features/Admin/Migration/middleware.ts', () => ({
    handleMigrationGetHandler: migrationGet,
    handleMigrationPostHandler: migrationPost,
    handleMigrationExportHandler: migrationExport,
}))
mock.module('@/features/Admin/NpmImport/middleware.ts', () => ({
    handleNpmImportGetHandler: npmGet,
    handleNpmImportPostHandler: npmPost,
}))
mock.module('@/features/UserSettings/middleware.ts', () => ({
    getProfileImageResponseHandler: avatar,
}))
mock.module('@/features/Branding/middleware.ts', () => ({ getMailLogoResponseHandler: logo }))
mock.module('@/features/Health/middleware.ts', () => ({
    getFoundationReadinessHandler: mock(async () => ready),
}))

type RouteOptions = {
    server: {
        handlers: Record<
            string,
            (input: {
                request: Request
                params: Record<string, string>
            }) => Response | Promise<Response>
        >
    }
}
const routes = new Map<string, RouteOptions>()
mock.module('@tanstack/react-router', () => ({
    createFileRoute: (path: string) => (options: RouteOptions) => {
        routes.set(path, options)
        return { options }
    },
}))

const matrix: {
    path: string
    source: string
    methods: readonly string[]
    handler: HttpHandler
    arguments?: 'none' | 'job' | 'avatar' | 'logo'
}[] = [
    ...Object.entries({
        config: 'configure',
        delete: 'delete',
        'off-host': 'configureOffHost',
        restore: 'restore',
        start: 'start',
        status: 'status',
    }).map(([path, handler]) => ({
        path: `/api/admin/backups/${path}`,
        source: `api/admin/backups/${path}.ts`,
        methods: [path === 'status' ? 'GET' : 'POST'],
        handler: backups[handler]!,
    })),
    {
        path: '/api/admin/backups/$jobId/download',
        source: 'api/admin/backups/$jobId/download.ts',
        methods: ['GET'],
        handler: download,
        arguments: 'job',
    },
    {
        path: '/api/admin/diagnostics/domain',
        source: 'api/admin/diagnostics/domain.ts',
        methods: ['POST'],
        handler: diagnose,
    },
    ...Object.entries(monitoring).map(([path, handler]) => ({
        path: `/api/admin/monitoring/${path}`,
        source: `api/admin/monitoring/${path}.ts`,
        methods: path === 'policy' ? ['GET', 'POST'] : ['GET'],
        handler,
    })),
    {
        path: '/api/admin/oidc/providers',
        source: 'api/admin/oidc/providers.ts',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        handler: providers,
    },
    {
        path: '/api/admin/oidc/providers/test',
        source: 'api/admin/oidc/providers/test.ts',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        handler: providerTest,
    },
    {
        path: '/api/auth/oidc/start',
        source: 'api/auth/oidc/start.ts',
        methods: ['POST'],
        handler: oidc.start,
    },
    {
        path: '/api/auth/oidc/callback',
        source: 'api/auth/oidc/callback.ts',
        methods: ['GET'],
        handler: oidc.callback,
    },
    {
        path: '/api/auth/oidc/connections',
        source: 'api/auth/oidc/connections.ts',
        methods: ['GET', 'POST'],
        handler: connections,
    },
    {
        path: '/api/live-snapshot',
        source: 'api/live-snapshot.ts',
        methods: ['GET'],
        handler: snapshot,
    },
    {
        path: '/api/migration',
        source: 'api/migration.ts',
        methods: ['GET'],
        handler: migrationGet,
        arguments: 'none',
    },
    {
        path: '/api/migration',
        source: 'api/migration.ts',
        methods: ['POST'],
        handler: migrationPost,
    },
    {
        path: '/api/migration/export',
        source: 'api/migration/export.ts',
        methods: ['GET'],
        handler: migrationExport,
        arguments: 'none',
    },
    {
        path: '/api/npm-import',
        source: 'api/npm-import.ts',
        methods: ['GET'],
        handler: npmGet,
        arguments: 'none',
    },
    { path: '/api/npm-import', source: 'api/npm-import.ts', methods: ['POST'], handler: npmPost },
    {
        path: '/media/avatars/$userId',
        source: 'media/avatars/$userId.ts',
        methods: ['GET'],
        handler: avatar,
        arguments: 'avatar',
    },
    {
        path: '/media/mail-logo/$accent',
        source: 'media/mail-logo/$accent.ts',
        methods: ['GET'],
        handler: logo,
        arguments: 'logo',
    },
]
await Promise.all(
    [...new Set([...matrix.map(({ source }) => source), 'health/live.ts', 'health/ready.ts'])].map(
        (source) => import(`@/routes/${source}`),
    ),
)

test.each(matrix.flatMap((entry) => entry.methods.map((method) => ({ ...entry, method }))))(
    '$method $path preserves its request and delegates to its specific boundary',
    async (entry) => {
        const request = new Request(
            `https://fixture.example${entry.path.replace('$jobId', 'job-fixture')}?revision=7`,
            { method: entry.method, headers: { authorization: 'Bearer fixture-only' } },
        )
        const handler = routes.get(entry.path)?.server.handlers[entry.method]
        if (!handler) throw new Error(`Missing handler ${entry.method} ${entry.path}`)
        const result = await handler({
            request,
            params: { jobId: 'job-fixture', userId: 'user-fixture', accent: '112233' },
        })
        const actual = entry.handler.mock.calls.at(-1)
        if (entry.arguments === 'none') expect(actual).toEqual([])
        else if (entry.arguments === 'avatar') {
            expect(actual?.[0]).toEqual({ request, userId: 'user-fixture' })
        } else {
            expect(actual?.[0]).toBe(request)
            if (entry.arguments === 'job') expect(actual?.[1]).toBe('job-fixture')
            if (entry.arguments === 'logo') expect(actual?.[1]).toBe('112233')
        }
        expect(result.status).toBe(202)
        expect(result === (await entry.handler.mock.results.at(-1)?.value)).toBe(true)
        expect(result.headers.get('x-fixture-handler')).toBe(await result.text())
    },
)

test('health routes distinguish liveness from readiness and forbid caching either response', async () => {
    const request = new Request('https://fixture.example/health/ready')
    const input = { request, params: {} }
    const live = await routes.get('/health/live')!.server.handlers.GET!(input)
    expect(live.status).toBe(200)
    expect(live.headers.get('cache-control')).toBe('no-store')
    expect(await live.json()).toEqual({ status: 'ok' })
    const unavailable = await routes.get('/health/ready')!.server.handlers.GET!(input)
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ status: 'not_ready' })
    ready = true
    const available = await routes.get('/health/ready')!.server.handlers.GET!(input)
    expect(available.status).toBe(200)
    expect(available.headers.get('cache-control')).toBe('no-store')
    expect(await available.json()).toEqual({ status: 'ready' })
})
