// oxlint-disable no-await-in-loop -- Readiness probes must wait for the previous attempt and bounded backoff.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { SQL } from 'bun'

import { startTestUpstream } from './proxy-test-upstream'

const POSTGRES_IMAGE =
    'postgres:18.4-bookworm@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382'
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-smoke-' + runId
const databaseContainer = project + '-postgres'
const token = randomBytes(32).toString('hex')
const databasePassword = randomBytes(24).toString('hex')
const environment: NodeJS.ProcessEnv = {
    ...process.env,
    RENTNERPROXY_CONTROLLER_TOKEN: token,
    // Docker allocates free loopback ports, so normal dev services remain untouched.
    RENTNERPROXY_PROXY_DEV_HTTP_PORT: '0',
    RENTNERPROXY_PROXY_DEV_CONTROLLER_PORT: '0',
    POSTGRES_PASSWORD: databasePassword,
}
const compose = ['docker', 'compose', '-p', project, '-f', 'compose.proxy-dev.yml']
let assertions = 0

async function command(
    args: string[],
    options: { readonly inherit?: boolean; readonly timeoutMs?: number } = {},
): Promise<string> {
    const child = Bun.spawn({
        cmd: args,
        cwd: repositoryRoot,
        env: environment,
        stdin: 'ignore',
        stdout: options.inherit ? 'inherit' : 'pipe',
        stderr: options.inherit ? 'inherit' : 'pipe',
    })
    const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 30_000)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output, errors] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) {
            throw new Error('Smoke command failed: ' + args.slice(0, 2).join(' '))
        }

        return (output || errors).trim()
    } finally {
        clearTimeout(timeout)
    }
}

async function waitFor(
    check: () => Promise<boolean>,
    label: string,
    timeoutMs = 30_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        try {
            if (await check()) return
        } catch {
            // Containers may not be ready yet.
        }
        await Bun.sleep(150)
    }

    throw new Error('Timed out waiting for ' + label)
}

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

function publishedPort(output: string): number {
    assert.match(output, /^127\.0\.0\.1:\d+$/u)
    const port = Number(output.split(':').at(-1))
    assert.ok(port > 0 && port <= 65_535)
    return port
}

async function runSmoke(): Promise<void> {
    console.log('Starting isolated PostgreSQL and the real OpenResty runtime.')
    let closeDatabase: (() => Promise<void>) | undefined
    const upstreamHost =
        process.env.RENTNERPROXY_TEST_UPSTREAM_HOST ??
        (process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1')
    const first = startTestUpstream({ hostname: upstreamHost, port: 0, message: 'upstream-one' })
    const second = startTestUpstream({ hostname: upstreamHost, port: 0, message: 'upstream-two' })

    try {
        await command(['docker', 'version', '--format', '{{.Server.Version}}'])
        await command(
            [
                'docker',
                'run',
                '--detach',
                '--name',
                databaseContainer,
                '--publish',
                '127.0.0.1::5432',
                '--env',
                'POSTGRES_USER=rentnerproxy_smoke',
                '--env',
                'POSTGRES_DB=rentnerproxy_smoke',
                '--env',
                'POSTGRES_PASSWORD',
                POSTGRES_IMAGE,
            ],
            { timeoutMs: 180_000 },
        )
        const databasePort = publishedPort(
            await command(['docker', 'port', databaseContainer, '5432/tcp']),
        )
        const databaseUrl =
            'postgresql://rentnerproxy_smoke:' +
            databasePassword +
            '@127.0.0.1:' +
            databasePort +
            '/rentnerproxy_smoke'
        process.env.DATABASE_URL = databaseUrl
        process.env.NODE_ENV = 'test'
        process.env.APP_URL = 'http://localhost:5173'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = token
        environment.DATABASE_URL = databaseUrl

        const probeDatabase = new SQL(databaseUrl)
        try {
            await waitFor(async () => {
                await probeDatabase`select 1`
                return true
            }, 'isolated PostgreSQL')
        } finally {
            await probeDatabase.close()
        }

        await command([process.execPath, 'run', 'db:migrate'], { inherit: true })
        await command([...compose, 'up', '--build', '--detach'], {
            inherit: true,
            timeoutMs: 600_000,
        })
        let proxyUrl = ''
        let controllerUrl = ''
        async function refreshRuntimeAddresses(): Promise<void> {
            const [httpAddress, controllerAddress] = await Promise.all([
                command([...compose, 'port', 'proxy-runtime', '8080']),
                command([...compose, 'port', 'proxy-runtime', '8081']),
            ])
            proxyUrl = 'http://127.0.0.1:' + publishedPort(httpAddress)
            controllerUrl = 'http://127.0.0.1:' + publishedPort(controllerAddress)
            process.env.RENTNERPROXY_CONTROLLER_URL = controllerUrl
        }
        // Docker may allocate different ephemeral host ports after restart/start.
        await refreshRuntimeAddresses()

        const [
            { eq },
            { requestHandler },
            { SESSION_COOKIE_NAME },
            { SYSTEM_ROLES },
            { proxyHosts, roles, userRoles, users },
            { getAuthDatabase },
            { createSessionService },
            services,
            runtime,
            editor,
            hostEditor,
            controller,
        ] = await Promise.all([
            import('drizzle-orm'),
            import('@tanstack/react-start/server'),
            import('../web/src/config/auth.config'),
            import('../web/src/config/permissions.config'),
            import('../web/src/db/schema'),
            import('../web/src/server/Auth/Core/database.server'),
            import('../web/src/server/Auth/Access/sessions.service'),
            import('../web/src/server/Admin/ProxyHostManagement/proxy-hosts.service'),
            import('../web/src/server/ProxyRuntime/proxy-runtime.service'),
            import('../web/src/server/ProxyRuntime/proxy-config-editor.service'),
            import('../web/src/server/ProxyRuntime/proxy-host-config-editor.service'),
            import('../web/src/server/Foundation/controller.server'),
        ])
        const database = getAuthDatabase()
        closeDatabase = () => database.$client.close()

        await waitFor(
            async () => (await controller.getProxyRuntimeStatus())?.running === true,
            'OpenResty startup',
        )
        const version = await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            '/usr/local/openresty/nginx/sbin/nginx',
            '-v',
        ])
        assert.match(version, /openresty\/1\.31\.1\.1/u)
        console.log(version)
        passed('OpenResty runtime and two real Bun backends started')

        async function proxyRequest(host: string, path = '/') {
            return fetch(proxyUrl + path, {
                headers: { host, connection: 'close' },
                signal: AbortSignal.timeout(5_000),
            })
        }

        async function expectProxyStatus(host: string, expected: number): Promise<void> {
            await waitFor(
                async () => {
                    const response = await proxyRequest(host)
                    await response.body?.cancel()
                    return response.status === expected
                },
                'HTTP ' + expected + ' for ' + host,
                5_000,
            )
        }

        async function expectProxyMessage(host: string, expected: string): Promise<void> {
            await waitFor(
                async () => {
                    const response = await proxyRequest(host)
                    if (response.status !== 200) {
                        await response.body?.cancel()
                        return false
                    }
                    return (await response.json()).message === expected
                },
                'backend response for ' + host,
                5_000,
            )
        }

        await expectProxyStatus('unknown.test', 404)
        passed('initial unknown host returns 404')

        const [ownerRole] = await database
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
        assert.ok(ownerRole)
        const [actor] = await database
            .insert(users)
            .values({
                displayName: 'Proxy smoke test owner',
                email: runId + '@proxy-smoke.invalid',
                emailVerifiedAt: new Date(),
                mustChangePassword: false,
                status: 'active',
            })
            .returning({ id: users.id })
        assert.ok(actor)
        await database.insert(userRoles).values({ userId: actor.id, roleId: ownerRole.id })
        const session = await createSessionService(actor.id)
        const [viewerRole] = await database
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.VIEWER))
        assert.ok(viewerRole)
        const [viewer] = await database
            .insert(users)
            .values({
                displayName: 'Proxy smoke test viewer',
                email: runId + '-viewer@proxy-smoke.invalid',
                emailVerifiedAt: new Date(),
                mustChangePassword: false,
                status: 'active',
            })
            .returning({ id: users.id })
        assert.ok(viewer)
        await database.insert(userRoles).values({ userId: viewer.id, roleId: viewerRole.id })
        const viewerSession = await createSessionService(viewer.id)

        async function authorizedAs<T>(
            sessionToken: string,
            operation: () => Promise<T>,
        ): Promise<T> {
            let outcome: { value: T } | { error: unknown } | undefined
            const handler = requestHandler(async () => {
                try {
                    outcome = { value: await operation() }
                } catch (error) {
                    outcome = { error }
                }
                return new Response(null, { status: 204 })
            })
            await handler(
                new Request('http://localhost/', {
                    headers: { cookie: SESSION_COOKIE_NAME + '=' + sessionToken },
                }),
                {},
            )
            assert.ok(outcome)
            if ('error' in outcome) throw outcome.error
            return outcome.value
        }

        async function authorized<T>(operation: () => Promise<T>): Promise<T> {
            return authorizedAs(session.token, operation)
        }

        const longDomain = [
            'a'.repeat(63),
            'b'.repeat(63),
            'c'.repeat(63),
            'd'.repeat(56),
            'test',
        ].join('.')
        assert.equal(longDomain.length, 253)
        const hostInput = {
            domains: ['demo.test', longDomain],
            enabled: true,
            forwardScheme: 'http' as const,
            forwardHost: 'host.docker.internal',
            forwardPort: first.port!,
        }
        const created = await authorized(() => services.createProxyHostService(hostInput))
        assert.equal(created.runtimeStatus, 'applied')
        // A graceful reload briefly overlaps retiring and new workers. Poll new HTTP
        // connections for the expected routing; never restart the engine to apply it.
        await expectProxyMessage('demo.test', 'upstream-one')
        passed('authorized create -> PostgreSQL -> full snapshot -> OpenResty -> backend response')
        await expectProxyMessage(longDomain, 'upstream-one')
        passed('maximum-length 253-character domain routes through the real engine')

        const path = '/api/test?hello=world&second=a%2Fb'
        const forwarded = await (await proxyRequest('demo.test', path)).json()
        assert.equal(forwarded.path, path)
        assert.equal(forwarded.method, 'GET')
        passed('path and query preserved')
        assert.equal(forwarded.host, 'demo.test')
        assert.ok(forwarded['x-real-ip'])
        assert.ok(forwarded['x-forwarded-for'].includes(forwarded['x-real-ip']))
        assert.equal(forwarded['x-forwarded-proto'], 'http')
        passed('Host, X-Real-IP, X-Forwarded-For and X-Forwarded-Proto')

        const beforeReload = await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            'cat',
            '/var/lib/rentnerproxy/proxy/engine.pid',
        ])
        const updated = await authorized(() =>
            services.updateProxyHostService({
                ...hostInput,
                proxyHostId: created.id,
                forwardPort: second.port!,
            }),
        )
        assert.equal(updated.runtimeStatus, 'applied')
        await expectProxyMessage('demo.test', 'upstream-two')
        assert.equal(
            await command([
                ...compose,
                'exec',
                '-T',
                'proxy-runtime',
                'cat',
                '/var/lib/rentnerproxy/proxy/engine.pid',
            ]),
            beforeReload,
        )
        passed('backend update with graceful reload and unchanged master PID')

        const initialSnapshot = await runtime.getProxyRuntimeSnapshotService()
        await assert.rejects(
            () => authorizedAs(viewerSession.token, () => editor.getProxyConfigEditorService()),
            (error: unknown) => (error as { code?: unknown }).code === 'permission_denied',
        )
        const viewerEditor = await authorized(() => editor.getProxyConfigEditorService())
        assert.equal(viewerEditor.baseRevision, initialSnapshot.revision)
        assert.equal(viewerEditor.settingsSource, '')
        assert.equal(viewerEditor.active?.revision, initialSnapshot.revision)
        assert.match(viewerEditor.active?.config ?? '', /# rentnerproxy-revision: /u)
        assert.ok(viewerEditor.defaults?.revision)
        assert.match(viewerEditor.defaults?.config ?? '', /# rentnerproxy-revision: /u)

        const editorSaveInput = {
            baseRevision: initialSnapshot.revision,
            settingsSource: [
                'keepalive_timeout 75s;',
                'send_timeout 30s;',
                'proxy_send_timeout 300s;',
                'proxy_read_timeout 300s;',
                'proxy_connect_timeout 15s;',
                'client_max_body_size 10m;',
            ].join('\n'),
        }
        await assert.rejects(
            () =>
                authorizedAs(viewerSession.token, () =>
                    editor.saveProxyConfigEditorService(editorSaveInput),
                ),
            (error: unknown) => {
                assert.equal((error as { code?: unknown }).code, 'permission_denied')
                return true
            },
        )
        await assert.rejects(
            () =>
                authorizedAs(viewerSession.token, () =>
                    editor.resetProxyConfigEditorService({
                        baseRevision: initialSnapshot.revision,
                    }),
                ),
            (error: unknown) => {
                assert.equal((error as { code?: unknown }).code, 'permission_denied')
                return true
            },
        )
        passed('full config source requires expert permission; viewer cannot save or reset')

        const beforePreview = await authorized(() => editor.getProxyConfigEditorService())
        const activeBeforePreview = (await controller.getProxyRuntimeStatus())?.activeRevision
        const preview = await authorized(() =>
            editor.previewProxyConfigEditorService('client_max_body_size 10m;'),
        )
        assert.notEqual(preview.revision, activeBeforePreview)
        assert.equal(
            (await controller.getProxyRuntimeStatus())?.activeRevision,
            activeBeforePreview,
        )
        assert.deepEqual(
            await authorized(() => editor.getProxyConfigEditorService()),
            beforePreview,
        )
        passed('safe editor preview renders a candidate without changing active or stored state')

        const saved = await authorized(() => editor.saveProxyConfigEditorService(editorSaveInput))
        assert.equal(saved, 'applied')
        const configuredSnapshot = await runtime.getProxyRuntimeSnapshotService()
        assert.equal(configuredSnapshot.version, 2)
        assert.deepEqual(configuredSnapshot.httpSettings, {
            clientMaxBodySizeBytes: 10 * 1_024 * 1_024,
            proxyConnectTimeoutSeconds: 15,
            proxyReadTimeoutSeconds: 300,
            proxySendTimeoutSeconds: 300,
            sendTimeoutSeconds: 30,
            keepaliveTimeoutSeconds: 75,
        })
        assert.notEqual(configuredSnapshot.revision, initialSnapshot.revision)
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('owner save applies v2 HTTP settings and preserves real forwarding')

        const staleEditor = await authorized(() => editor.getProxyConfigEditorService())
        const changed = await authorized(() =>
            editor.saveProxyConfigEditorService({
                baseRevision: staleEditor.baseRevision,
                settingsSource: 'client_max_body_size 8m;',
            }),
        )
        assert.equal(changed, 'applied')
        const changedEditor = await authorized(() => editor.getProxyConfigEditorService())
        await assert.rejects(
            () =>
                authorized(() =>
                    editor.saveProxyConfigEditorService({
                        baseRevision: staleEditor.baseRevision,
                        settingsSource: 'send_timeout 30s;',
                    }),
                ),
            (error: unknown) => {
                assert.equal((error as { code?: unknown }).code, 'configuration_conflict')
                return true
            },
        )
        assert.deepEqual(
            await authorized(() => editor.getProxyConfigEditorService()),
            changedEditor,
        )
        passed('stale editor save is rejected by the full snapshot revision CAS')

        const beforeInvalid = await authorized(() => editor.getProxyConfigEditorService())
        const activeBeforeInvalid = (await controller.getProxyRuntimeStatus())?.activeRevision
        for (const source of ['include /etc/nginx/nginx.conf;', 'lua_code_cache on;']) {
            await assert.rejects(() =>
                authorized(() =>
                    editor.saveProxyConfigEditorService({
                        baseRevision: beforeInvalid.baseRevision,
                        settingsSource: source,
                    }),
                ),
            )
        }
        assert.deepEqual(
            await authorized(() => editor.getProxyConfigEditorService()),
            beforeInvalid,
        )
        assert.equal(
            (await controller.getProxyRuntimeStatus())?.activeRevision,
            activeBeforeInvalid,
        )
        await expectProxyMessage('demo.test', 'upstream-two')
        passed(
            'structured settings still reject raw directives; free expert text uses its separate field',
        )

        const resetState = await authorized(() => editor.getProxyConfigEditorService())
        assert.equal(
            await authorized(() =>
                editor.resetProxyConfigEditorService({ baseRevision: resetState.baseRevision }),
            ),
            'applied',
        )
        const resetSnapshot = await runtime.getProxyRuntimeSnapshotService()
        const resetEditor = await authorized(() => editor.getProxyConfigEditorService())
        assert.equal(resetSnapshot.version, 1)
        assert.equal(resetSnapshot.revision, initialSnapshot.revision)
        assert.deepEqual(resetSnapshot.proxyHosts, initialSnapshot.proxyHosts)
        assert.equal(resetEditor.settingsSource, '')
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('editor reset restores v1 defaults while retaining current hosts and routing')

        const hostState = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        assert.equal(hostState.advancedConfig, '')
        assert.ok(hostState.defaults?.config.includes('# rentnerproxy: host HTTP settings begin'))
        const hostSettingsSource = [
            'client_max_body_size 16m;',
            'proxy_connect_timeout 12s;',
            'proxy_read_timeout 180s;',
            'proxy_send_timeout 180s;',
            'send_timeout 45s;',
            'keepalive_timeout 70s;',
        ].join('\n')
        const advancedConfig = [
            '# Free server-context configuration',
            'add_header X-RentnerProxy-Advanced "works" always;',
            'location = /rentnerproxy-advanced-test {',
            '    return 200 "advanced-ok";',
            '}',
            '',
        ].join('\n')
        const advancedPreview = await authorized(() =>
            hostEditor.previewProxyHostConfigEditorService({
                proxyHostId: created.id,
                settingsSource: hostSettingsSource,
                advancedConfig,
            }),
        )
        assert.ok(advancedPreview.config.includes(advancedConfig))
        assert.ok(
            advancedPreview.config.indexOf(advancedConfig) >
                advancedPreview.config.indexOf('location / {'),
        )
        assert.equal(
            (await controller.getProxyRuntimeStatus())?.activeRevision,
            initialSnapshot.revision,
        )
        passed('free host preview preserves raw text at server context without applying')

        const advancedSave = await authorized(() =>
            hostEditor.saveProxyHostConfigEditorService({
                proxyHostId: created.id,
                baseRevision: hostState.baseRevision,
                settingsSource: hostSettingsSource,
                advancedConfig: advancedConfig.replaceAll('\n', '\r\n'),
            }),
        )
        assert.equal(advancedSave.runtimeStatus, 'applied')
        const advancedSnapshot = await runtime.getProxyRuntimeSnapshotService()
        assert.equal(advancedSnapshot.version, 3)
        assert.equal(advancedSnapshot.proxyHosts[0]?.advancedConfig, advancedConfig)
        assert.equal(Object.keys(advancedSnapshot.proxyHosts[0]?.httpSettings ?? {}).length, 6)
        const activeHost = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        assert.equal(activeHost.advancedConfig, advancedConfig)
        assert.ok(activeHost.active?.config.includes(advancedConfig))
        assert.ok(activeHost.active?.config.includes('client_max_body_size 16777216;'))
        assert.ok(activeHost.active?.config.includes('proxy_connect_timeout 12s;'))
        assert.ok(activeHost.active?.config.includes('proxy_read_timeout 180s;'))
        assert.ok(activeHost.active?.config.includes('proxy_send_timeout 180s;'))
        assert.ok(activeHost.active?.config.includes('send_timeout 45s;'))
        assert.ok(activeHost.active?.config.includes('keepalive_timeout 70s;'))
        passed(
            'all six structured host settings coexist with persisted normalized raw configuration',
        )

        async function expectAdvancedHeader(value: string): Promise<void> {
            await waitFor(
                async () => {
                    const response = await proxyRequest('demo.test')
                    if (
                        response.status !== 200 ||
                        response.headers.get('x-rentnerproxy-advanced') !== value
                    ) {
                        await response.body?.cancel()
                        return false
                    }
                    return (await response.json()).message === 'upstream-two'
                },
                'advanced response header and backend response',
                5000,
            )
        }
        async function expectAdvancedLocation(value: string): Promise<void> {
            await waitFor(
                async () => {
                    const response = await proxyRequest('demo.test', '/rentnerproxy-advanced-test')
                    const text = await response.text()
                    return response.status === 200 && text === value
                },
                'custom server-context location response',
                5000,
            )
        }
        await expectAdvancedHeader('works')
        passed('real OpenResty add_header reaches the browser with the backend response')
        await expectAdvancedLocation('advanced-ok')
        passed('real free custom location returns advanced-ok')

        const withoutExpert = await authorizedAs(viewerSession.token, () =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        assert.equal(Object.hasOwn(withoutExpert, 'advancedConfig'), false)
        assert.equal(withoutExpert.active, null)
        assert.equal(JSON.stringify(withoutExpert).includes('X-RentnerProxy-Advanced'), false)
        const viewerPreview = await authorizedAs(viewerSession.token, () =>
            hostEditor.previewProxyHostConfigEditorService({
                proxyHostId: created.id,
                settingsSource: '',
            }),
        )
        assert.equal(viewerPreview.config.includes('X-RentnerProxy-Advanced'), false)
        const normalList = await authorizedAs(viewerSession.token, () =>
            services.getProxyHostsService(),
        )
        assert.equal(JSON.stringify(normalList).includes('advancedConfig'), false)
        passed('normal list and viewer editor sources do not expose expert configuration')

        const neighbor = await authorized(() =>
            services.createProxyHostService({
                ...hostInput,
                domains: ['neighbor.test'],
            }),
        )
        assert.equal(neighbor.runtimeStatus, 'applied')
        await expectProxyMessage('neighbor.test', 'upstream-one')
        const neighborResponse = await proxyRequest('neighbor.test')
        assert.equal(neighborResponse.headers.get('x-rentnerproxy-advanced'), null)
        await neighborResponse.body?.cancel()
        const neighborState = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(neighbor.id),
        )
        assert.equal(neighborState.advancedConfig, '')
        assert.equal(neighborState.active?.config.includes(advancedConfig), false)
        passed('host editor source and raw directives stay separate from another proxy host')

        const beforeInvalidRaw = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        const workingRevision = (await controller.getProxyRuntimeStatus())?.activeRevision
        const invalidRaw = 'this_directive_should_not_exist;'
        const rejectedRaw = await authorized(() =>
            hostEditor.saveProxyHostConfigEditorService({
                proxyHostId: created.id,
                baseRevision: beforeInvalidRaw.baseRevision,
                settingsSource: hostSettingsSource,
                advancedConfig: invalidRaw,
            }),
        )
        assert.equal(rejectedRaw.runtimeStatus, 'pending')
        const [persistedRaw] = await database
            .select({ advancedConfig: proxyHosts.advancedConfig })
            .from(proxyHosts)
            .where(eq(proxyHosts.id, created.id))
        assert.equal(persistedRaw?.advancedConfig, invalidRaw)
        const invalidDesired = await runtime.getProxyRuntimeSnapshotService()
        assert.notEqual(invalidDesired.revision, workingRevision)
        assert.equal((await controller.getProxyRuntimeStatus())?.activeRevision, workingRevision)
        assert.equal(
            (await authorized(() => runtime.getProxyRuntimeStatusService())).state,
            'pending',
        )
        const rawApplyFailure = await fetch(controllerUrl + '/internal/v1/proxy/config', {
            method: 'PUT',
            headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify(invalidDesired),
            signal: AbortSignal.timeout(20_000),
        })
        assert.equal(rawApplyFailure.status, 502)
        assert.deepEqual(await rawApplyFailure.json(), { error: 'apply_failed' })
        passed('invalid raw directive stays in desired DB state while nginx -t rejects it safely')

        await expectAdvancedHeader('works')
        await expectAdvancedLocation('advanced-ok')
        const afterInvalidRaw = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        assert.deepEqual(afterInvalidRaw.active, beforeInvalidRaw.active)
        passed(
            'failed raw candidate preserves active revision, previous header, location and HTTP 200 traffic',
        )

        const recoveredRaw = advancedConfig
            .replace('"works"', '"recovered"')
            .replace('"advanced-ok"', '"advanced-restored"')
        const recovered = await authorized(() =>
            hostEditor.saveProxyHostConfigEditorService({
                proxyHostId: created.id,
                baseRevision: afterInvalidRaw.baseRevision,
                settingsSource: hostSettingsSource,
                advancedConfig: recoveredRaw,
            }),
        )
        assert.equal(recovered.runtimeStatus, 'applied')
        await expectAdvancedHeader('recovered')
        await expectAdvancedLocation('advanced-restored')
        const recoveredStatus = await authorized(() => runtime.getProxyRuntimeStatusService())
        assert.equal(recoveredStatus.state, 'synced')
        assert.equal(recoveredStatus.activeRevision, recoveredStatus.desiredRevision)
        passed('corrected raw configuration applies and reaches synchronized state')

        const rawBeforeRestart = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        const beforeEquivalent = await controller.getProxyRuntimeStatus()
        assert.equal(
            (
                await authorized(() =>
                    hostEditor.saveProxyHostConfigEditorService({
                        proxyHostId: created.id,
                        baseRevision: rawBeforeRestart.baseRevision,
                        settingsSource: hostSettingsSource,
                        advancedConfig: recoveredRaw.replaceAll('\n', '\r\n'),
                    }),
                )
            ).runtimeStatus,
            'applied',
        )
        assert.equal(
            (await controller.getProxyRuntimeStatus())?.lastApplyAt,
            beforeEquivalent?.lastApplyAt,
        )
        passed('equivalent CRLF raw configuration keeps its revision and avoids a reload')

        await command([...compose, 'restart', 'proxy-runtime'])
        await refreshRuntimeAddresses()
        await waitFor(async () => {
            const status = await controller.getProxyRuntimeStatus()
            return (
                status?.running === true && status.activeRevision === recoveredStatus.activeRevision
            )
        }, 'persisted expert configuration after restart')
        await expectAdvancedHeader('recovered')
        await expectAdvancedLocation('advanced-restored')
        assert.deepEqual(
            (await authorized(() => hostEditor.getProxyHostConfigEditorService(created.id))).active,
            rawBeforeRestart.active,
        )
        passed('expert config and the exact active host source survive controller restart')

        const rawResetState = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        assert.equal(
            (
                await authorized(() =>
                    hostEditor.resetProxyHostConfigEditorService({
                        proxyHostId: created.id,
                        baseRevision: rawResetState.baseRevision,
                        resetAdvancedConfig: true,
                    }),
                )
            ).runtimeStatus,
            'applied',
        )
        const clearedHost = await authorized(() =>
            hostEditor.getProxyHostConfigEditorService(created.id),
        )
        assert.equal(clearedHost.settingsSource, '')
        assert.equal(clearedHost.advancedConfig, '')
        await expectProxyMessage('demo.test', 'upstream-two')
        await expectProxyMessage('neighbor.test', 'upstream-one')
        const clearedResponse = await proxyRequest('demo.test')
        assert.equal(clearedResponse.headers.get('x-rentnerproxy-advanced'), null)
        await clearedResponse.body?.cancel()
        await authorized(() => services.deleteProxyHostService(neighbor.id))
        assert.deepEqual(await runtime.getProxyRuntimeSnapshotService(), initialSnapshot)
        passed('host reset clears expert and structured overrides without deleting other hosts')

        const snapshot = await runtime.getProxyRuntimeSnapshotService()
        const beforeUnchanged = await controller.getProxyRuntimeStatus()
        const repeated = await controller.applyProxyRuntimeConfiguration(snapshot)
        assert.equal(repeated?.status, 'unchanged')
        assert.equal(repeated?.lastApplyAt, beforeUnchanged?.lastApplyAt)
        passed('identical snapshot is unchanged')

        const invalid = await fetch(controllerUrl + '/internal/v1/proxy/config', {
            method: 'PUT',
            headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({
                ...snapshot,
                proxyHosts: [{ ...snapshot.proxyHosts[0], domains: ['demo.test; return 200;'] }],
            }),
        })
        assert.equal(invalid.status, 422)
        assert.equal((await invalid.json()).error, 'validation_failed')
        assert.equal((await controller.getProxyRuntimeStatus())?.activeRevision, snapshot.revision)
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('injection rejected without changing the working proxy')

        const unresolvableHosts = snapshot.proxyHosts.map((host) => ({
            ...host,
            forwardHost: runId + '.upstream.invalid',
        }))
        const unresolvableCanonical = JSON.stringify({ version: 1, proxyHosts: unresolvableHosts })
        const rejectedCandidate = await fetch(controllerUrl + '/internal/v1/proxy/config', {
            method: 'PUT',
            headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
            body: JSON.stringify({
                version: 1,
                revision:
                    'sha256:' +
                    new Bun.CryptoHasher('sha256').update(unresolvableCanonical).digest('hex'),
                proxyHosts: unresolvableHosts,
            }),
            signal: AbortSignal.timeout(20_000),
        })
        assert.equal(rejectedCandidate.status, 502)
        assert.equal((await rejectedCandidate.json()).error, 'apply_failed')
        assert.equal((await controller.getProxyRuntimeStatus())?.activeRevision, snapshot.revision)
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('real nginx -t failure preserves the active revision and working backend')

        assert.equal((await fetch(controllerUrl + '/internal/v1/proxy/status')).status, 401)
        passed('controller requires authentication')

        await command([...compose, 'restart', 'proxy-runtime'])
        await refreshRuntimeAddresses()
        await waitFor(async () => {
            const status = await controller.getProxyRuntimeStatus()
            return status?.running === true && status.activeRevision === snapshot.revision
        }, 'persisted active revision after restart')
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('controller restart restores last successfully applied state')

        await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            '/usr/local/openresty/nginx/sbin/nginx',
            '-p',
            '/var/lib/rentnerproxy/proxy/',
            '-c',
            'active.conf',
            '-s',
            'quit',
        ])
        await waitFor(
            async () => (await controller.getProxyRuntimeStatus())?.running === false,
            'engine-only shutdown',
        )
        assert.equal(await authorized(() => runtime.applyProxyConfigurationService()), 'pending')
        assert.equal((await controller.getProxyRuntimeStatus())?.activeRevision, snapshot.revision)
        assert.equal(
            (await authorized(() => runtime.getProxyRuntimeStatusService())).state,
            'unavailable',
        )
        assert.ok(
            (await authorized(() => services.getProxyHostsService())).some(
                (host) => host.id === created.id,
            ),
        )
        passed('engine down: controller and desired-state reads remain available; apply is pending')

        await command([...compose, 'restart', 'proxy-runtime'])
        await refreshRuntimeAddresses()
        await waitFor(async () => {
            const status = await controller.getProxyRuntimeStatus()
            return status?.running === true && status.activeRevision === snapshot.revision
        }, 'recovery after engine-only shutdown')
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('engine recovery retains the last working configuration')

        assert.equal(
            (await authorized(() => services.disableProxyHostService(created.id))).runtimeStatus,
            'applied',
        )
        await expectProxyStatus('demo.test', 404)
        await expectProxyStatus(longDomain, 404)
        passed('disable removes routing')
        assert.equal(
            (await authorized(() => services.enableProxyHostService(created.id))).runtimeStatus,
            'applied',
        )
        await expectProxyStatus('demo.test', 200)
        passed('enable restores routing')

        await command([...compose, 'stop', 'proxy-runtime'])
        const offline = await authorized(() =>
            services.createProxyHostService({
                ...hostInput,
                domains: ['offline.test'],
            }),
        )
        assert.equal(offline.runtimeStatus, 'pending')
        assert.ok(
            (await authorized(() => services.getProxyHostsService())).some(
                (host) => host.id === offline.id,
            ),
        )
        passed('controller down: desired state committed and pending returned')

        await command([...compose, 'start', 'proxy-runtime'])
        await refreshRuntimeAddresses()
        await waitFor(
            async () => (await controller.getProxyRuntimeStatus())?.running === true,
            'controller recovery',
        )
        assert.equal(
            (await authorized(() => runtime.getProxyRuntimeStatusService())).state,
            'pending',
        )
        assert.equal(await authorized(() => runtime.applyProxyConfigurationService()), 'applied')
        await expectProxyStatus('offline.test', 200)
        assert.equal(
            (await authorized(() => runtime.getProxyRuntimeStatusService())).state,
            'synced',
        )
        passed('manual apply reconciles saved changes after controller recovery')

        await authorized(() => services.deleteProxyHostService(offline.id))
        assert.equal(
            (await authorized(() => services.deleteProxyHostService(created.id))).runtimeStatus,
            'applied',
        )
        await expectProxyStatus('demo.test', 404)
        await expectProxyStatus('offline.test', 404)
        await expectProxyStatus('unknown.test', 404)
        await expectProxyStatus(longDomain, 404)
        passed('delete removes routing; unknown hosts remain closed')

        console.log('Real proxy runtime integration: ' + assertions + ' checks passed.')
    } catch (error) {
        const logs = await command([
            ...compose,
            'logs',
            '--no-color',
            '--tail',
            '40',
            'proxy-runtime',
        ]).catch(() => '')
        if (logs)
            console.error(
                logs.replaceAll(token, '[redacted]').replaceAll(databasePassword, '[redacted]'),
            )
        throw error
    } finally {
        await first.stop(true)
        await second.stop(true)
        if (closeDatabase) await closeDatabase().catch(() => undefined)
        // These names are generated above for this run; no existing dev volume/database is touched.
        await command([...compose, 'down', '--volumes', '--remove-orphans']).catch(() => undefined)
        await command(['docker', 'rm', '--force', '--volumes', databaseContainer]).catch(
            () => undefined,
        )
    }
}

await runSmoke()
