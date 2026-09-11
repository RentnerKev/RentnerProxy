// oxlint-disable no-await-in-loop -- Readiness probes must wait for the previous attempt and bounded backoff.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { SQL } from 'bun'

import { startTestUpstream } from './proxy-test-upstream'
import { smokeCompose, smokeDockerArguments } from './smoke-resources'

function basicHeader(username: string, password: string): string {
    return 'Basic ' + Buffer.from(username + ':' + password).toString('base64')
}

const POSTGRES_IMAGE =
    'postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280'
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-smoke-' + runId
const databaseContainer = project + '-postgres'
const token = randomBytes(32).toString('hex')
const databasePassword = randomBytes(24).toString('hex')
const temporaryComposeDirectory = await mkdtemp(join(tmpdir(), 'rentnerproxy-proxy-smoke-'))
const temporaryComposeFile = join(temporaryComposeDirectory, 'docker-compose.yml')
const environment: NodeJS.ProcessEnv = {
    ...process.env,
    RENTNERPROXY_CONTROLLER_TOKEN: token,
    // Docker allocates free loopback ports, so normal dev services remain untouched.
    RENTNERPROXY_PROXY_DEV_HTTP_PORT: '0',
    RENTNERPROXY_PROXY_DEV_HTTPS_PORT: '0',
    RENTNERPROXY_PROXY_DEV_CONTROLLER_PORT: '0',
    RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT: '443',
    POSTGRES_PASSWORD: databasePassword,
}
await writeFile(
    temporaryComposeFile,
    smokeCompose(
        JSON.stringify(
            {
                services: {
                    'proxy-runtime': {
                        build: {
                            context: repositoryRoot,
                            dockerfile: 'docker/proxy-runtime/Dockerfile',
                        },
                        environment: {
                            RENTNERPROXY_CONTROLLER_TOKEN:
                                '${RENTNERPROXY_CONTROLLER_TOKEN:?Set a random server-only controller token}',
                            RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT:
                                '${RENTNERPROXY_PROXY_PUBLIC_HTTPS_PORT:-443}',
                            RUST_LOG: '${RUST_LOG:-info}',
                        },
                        ports: [
                            '127.0.0.1:${RENTNERPROXY_PROXY_DEV_HTTP_PORT:-0}:8080',
                            '127.0.0.1:${RENTNERPROXY_PROXY_DEV_HTTPS_PORT:-0}:8443',
                            '127.0.0.1:${RENTNERPROXY_PROXY_DEV_CONTROLLER_PORT:-0}:8081',
                        ],
                        extra_hosts: ['host.docker.internal:host-gateway'],
                        volumes: ['proxy-state:/var/lib/rentnerproxy/proxy'],
                        security_opt: ['no-new-privileges:true'],
                        cap_drop: ['ALL'],
                        stop_grace_period: '15s',
                    },
                },
                volumes: { 'proxy-state': {} },
            },
            null,
            2,
        ) + '\n',
    ),
    { encoding: 'utf8', mode: 0o600 },
)
const compose = ['docker', 'compose', '-p', project, '-f', temporaryComposeFile]
let assertions = 0

async function command(
    args: string[],
    options: { readonly inherit?: boolean; readonly timeoutMs?: number } = {},
): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(args),
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
    console.log('Starting isolated PostgreSQL and the real Caddy runtime.')
    let closeDatabase: (() => Promise<void>) | undefined
    let stopReconciliation: (() => Promise<void>) | undefined
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
            environment.RENTNERPROXY_CONTROLLER_URL = controllerUrl
        }
        // Docker may allocate different ephemeral host ports after restart/start.
        await refreshRuntimeAddresses()

        const [
            { eq },
            { requestHandler },
            { SESSION_COOKIE_NAME },
            { SYSTEM_ROLES },
            { roles, userRoles, users },
            { getAuthDatabase },
            { createSessionService },
            services,
            redirectServices,
            policyServices,
            basicAuthServices,
            runtime,
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
            import('../web/src/server/Admin/RedirectHostManagement/redirect-hosts.service'),
            import('../web/src/server/Admin/AccessPolicyManagement/access-policies.service'),
            import('../web/src/server/Admin/AccessPolicyManagement/basic-auth.service'),
            import('../web/src/server/ProxyRuntime/proxy-runtime.service'),
            import('../web/src/server/Foundation/controller.server'),
        ])
        const database = getAuthDatabase()
        closeDatabase = () => database.$client.close()
        stopReconciliation = runtime.stopProxyRuntimeReconciliation

        await waitFor(
            async () => (await controller.getProxyRuntimeStatus())?.running === true,
            'Caddy startup',
        )
        const version = await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            '/usr/bin/caddy',
            'version',
        ])
        assert.match(version, /v2\.11\.4/u)
        console.log(version)
        passed('Caddy runtime and two real Bun backends started')

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

        async function expectWebSocketUpgrade(host: string, authorization?: string): Promise<void> {
            const proxyPort = Number(new URL(proxyUrl).port)
            await new Promise<void>((resolve, reject) => {
                const socket = createConnection({ host: '127.0.0.1', port: proxyPort })
                let response = ''
                let settled = false
                const finish = (error?: Error) => {
                    if (settled) return
                    settled = true
                    socket.destroy()
                    if (error) reject(error)
                    else resolve()
                }
                socket.setTimeout(5_000, () => finish(new Error('WebSocket upgrade timed out')))
                socket.once('error', (error) => finish(error))
                socket.on('data', (chunk) => {
                    response += chunk.toString('latin1')
                    if (!response.includes('\r\n\r\n')) return
                    try {
                        assert.match(response, /^HTTP\/1\.1 101 Switching Protocols\r\n/iu)
                        assert.match(response, /^upgrade: websocket\r\n/imu)
                        assert.match(response, /^connection: Upgrade\r\n/imu)
                        finish()
                    } catch (error) {
                        finish(error instanceof Error ? error : new Error(String(error)))
                    }
                })
                socket.once('connect', () => {
                    socket.write(
                        'GET /websocket-smoke HTTP/1.1\r\n' +
                            'Host: ' +
                            host +
                            '\r\n' +
                            (authorization ? 'Authorization: ' + authorization + '\r\n' : '') +
                            'Connection: Upgrade\r\n' +
                            'Upgrade: websocket\r\n' +
                            'Sec-WebSocket-Version: 13\r\n' +
                            'Sec-WebSocket-Key: ' +
                            randomBytes(16).toString('base64') +
                            '\r\n' +
                            '\r\n',
                    )
                })
            })
        }

        async function expectRedirect(
            host: string,
            path: string,
            expectedStatus: number,
            expectedLocation: string,
        ): Promise<void> {
            await waitFor(
                async () => {
                    const response = await fetch(proxyUrl + path, {
                        headers: { host, connection: 'close' },
                        redirect: 'manual',
                        signal: AbortSignal.timeout(5_000),
                    })
                    const matches =
                        response.status === expectedStatus &&
                        response.headers.get('location') === expectedLocation
                    await response.body?.cancel()
                    return matches
                },
                'HTTP ' + expectedStatus + ' redirect for ' + host,
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
                status: 'active',
            })
            .returning({ id: users.id })
        assert.ok(actor)
        await database.insert(userRoles).values({ userId: actor.id, roleId: ownerRole.id })
        const session = await createSessionService(actor.id)
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
        // connections for the expected routing; never restart Caddy to apply it.
        await expectProxyMessage('demo.test', 'upstream-one')
        passed('authorized create -> PostgreSQL -> full snapshot -> Caddy -> backend response')
        await expectWebSocketUpgrade('demo.test')
        passed('WebSocket upgrade traverses Caddy and reaches the real Bun backend')
        await expectProxyMessage(longDomain, 'upstream-one')
        passed('maximum-length 253-character domain routes through real Caddy')

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
        const spoofedResponse = await fetch(proxyUrl + path, {
            headers: {
                host: 'demo.test',
                connection: 'close',
                'x-real-ip': '203.0.113.99',
                'x-forwarded-for': '203.0.113.99, 127.0.0.1',
                'x-forwarded-host': 'attacker.test',
                'x-forwarded-port': '1',
                'x-forwarded-prefix': '/attacker',
                'x-forwarded-proto': 'https',
                forwarded: 'for=127.0.0.1;host=attacker.test;proto=https',
                proxy: 'http://attacker.test:8080',
                authorization: 'Bearer public-upstream-token',
            },
        })
        assert.equal(spoofedResponse.status, 200)
        const sanitized = await spoofedResponse.json()
        assert.notEqual(sanitized['x-real-ip'], '203.0.113.99')
        assert.equal(sanitized['x-forwarded-for'], sanitized['x-real-ip'])
        assert.equal(sanitized['x-forwarded-host'], 'demo.test')
        assert.equal(sanitized['x-forwarded-proto'], 'http')
        assert.equal(sanitized['x-forwarded-port'], null)
        assert.equal(sanitized['x-forwarded-prefix'], null)
        assert.equal(sanitized.forwarded, null)
        assert.equal(sanitized.proxy, null)
        assert.equal(sanitized.hasAuthorization, true)
        assert.doesNotMatch(spoofedResponse.headers.get('server') ?? '', /[0-9]/u)
        passed('public proxy replaces forged forwarding headers and hides its version')

        const redirectInput = {
            domains: ['redirect.test'],
            destination: 'https://new.example.test/base',
            statusCode: 308 as const,
            preserveRequestUri: true,
            enabled: true,
            certificateId: null,
        }
        const createdRedirect = await authorized(() =>
            redirectServices.createRedirectHostService(redirectInput),
        )
        assert.equal(createdRedirect.runtimeStatus, 'applied')
        await expectRedirect(
            'redirect.test',
            '/old/path?value=a%2Fb&space=hello%20world',
            308,
            'https://new.example.test/base/old/path?value=a%2Fb&space=hello%20world',
        )
        passed('Redirect Host preserves the original path, encoded values and query')

        for (const statusCode of [301, 302, 307, 308] as const) {
            const updatedRedirect = await authorized(() =>
                redirectServices.updateRedirectHostService({
                    ...redirectInput,
                    redirectHostId: createdRedirect.id,
                    statusCode,
                }),
            )
            assert.equal(updatedRedirect.runtimeStatus, 'applied')
            await expectRedirect(
                'redirect.test',
                '/status-' + statusCode + '?check=1',
                statusCode,
                'https://new.example.test/base/status-' + statusCode + '?check=1',
            )
        }
        passed('real Caddy returns only the supported 301, 302, 307 and 308 statuses')

        const exactDestination = 'https://new.example.test/exact?fixed=a%2Fb#section'
        assert.equal(
            (
                await authorized(() =>
                    redirectServices.updateRedirectHostService({
                        ...redirectInput,
                        redirectHostId: createdRedirect.id,
                        destination: exactDestination,
                        statusCode: 302,
                        preserveRequestUri: false,
                    }),
                )
            ).runtimeStatus,
            'applied',
        )
        await expectRedirect('redirect.test', '/ignored/path?ignored=true', 302, exactDestination)
        passed('URI preservation off returns the configured destination exactly')

        assert.equal(
            (
                await authorized(() =>
                    redirectServices.disableRedirectHostService(createdRedirect.id),
                )
            ).runtimeStatus,
            'applied',
        )
        await expectProxyStatus('redirect.test', 404)
        assert.equal(
            (await authorized(() => redirectServices.enableRedirectHostService(createdRedirect.id)))
                .runtimeStatus,
            'applied',
        )
        await expectRedirect('redirect.test', '/ignored-after-enable', 302, exactDestination)
        assert.equal(
            (await authorized(() => redirectServices.deleteRedirectHostService(createdRedirect.id)))
                .runtimeStatus,
            'applied',
        )
        await expectProxyStatus('redirect.test', 404)
        await expectProxyMessage('demo.test', 'upstream-one')
        passed('Redirect enable, disable and delete reconcile without affecting Proxy Hosts')

        const updated = await authorized(() =>
            services.updateProxyHostService({
                ...hostInput,
                proxyHostId: created.id,
                forwardPort: second.port!,
            }),
        )
        assert.equal(updated.runtimeStatus, 'applied')
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('backend update with graceful Caddy reload')

        const policy = await authorized(() =>
            policyServices.createAccessPolicyService({
                name: 'Shared smoke access policy',
                mode: 'public',
                combination: null,
            }),
        )
        const policyHostInput = {
            ...hostInput,
            domains: ['policy.test'],
            accessPolicyId: policy.accessPolicyId,
        }
        const policyHost = await authorized(() => services.createProxyHostService(policyHostInput))
        const secondPolicyHost = await authorized(() =>
            services.createProxyHostService({
                ...policyHostInput,
                domains: ['policy-two.test'],
            }),
        )
        await expectProxyMessage('policy.test', 'upstream-one')
        await expectProxyMessage('policy-two.test', 'upstream-one')
        assert.equal(
            (await authorized(() => policyServices.getAccessPoliciesService())).find(
                (entry) => entry.id === policy.accessPolicyId,
            )?.assignedHostCount,
            2,
        )
        await assert.rejects(
            authorized(() => policyServices.deleteAccessPolicyService(policy.accessPolicyId)),
            { code: 'access_policy_in_use' },
        )
        passed('reusable public Access Policy is stored, assigned and enforced for two real hosts')

        for (const protectedMode of [
            { mode: 'authenticated', combination: null },
            { mode: 'ip-restricted', combination: null },
            { mode: 'combined', combination: 'all' },
            { mode: 'combined', combination: 'any' },
        ] as const) {
            const result = await authorized(() =>
                policyServices.updateAccessPolicyService({
                    accessPolicyId: policy.accessPolicyId,
                    name: 'Shared smoke access policy',
                    ...protectedMode,
                }),
            )
            assert.equal(result.runtimeStatus, 'applied')
            await expectProxyStatus('policy.test', 403)
            await expectProxyStatus('policy-two.test', 403)
            const forged = await fetch(proxyUrl + '/protected', {
                headers: {
                    host: 'policy.test',
                    'x-forwarded-for': '127.0.0.1',
                    'x-real-ip': '::1',
                    authorization: 'Basic Zml4dHVyZTpmaXh0dXJl',
                    connection: 'Upgrade',
                    upgrade: 'websocket',
                },
                signal: AbortSignal.timeout(5_000),
            })
            assert.equal(forged.status, 403)
            await forged.body?.cancel()
        }
        await expectProxyMessage('demo.test', 'upstream-two')
        passed(
            'all unconfigured protected modes and both combinations deny requests and spoofed headers',
        )

        await authorized(() => services.disableProxyHostService(secondPolicyHost.id))
        await assert.rejects(
            authorized(() => policyServices.deleteAccessPolicyService(policy.accessPolicyId)),
            { code: 'access_policy_in_use' },
        )
        await authorized(() => services.enableProxyHostService(secondPolicyHost.id))
        await authorized(() =>
            policyServices.updateAccessPolicyService({
                accessPolicyId: policy.accessPolicyId,
                name: 'Shared smoke access policy',
                mode: 'public',
                combination: null,
            }),
        )
        await expectProxyMessage('policy.test', 'upstream-one')
        await expectProxyMessage('policy-two.test', 'upstream-one')
        await authorized(() =>
            policyServices.updateAccessPolicyService({
                accessPolicyId: policy.accessPolicyId,
                name: 'Shared smoke access policy',
                mode: 'authenticated',
                combination: null,
            }),
        )
        await expectProxyStatus('policy.test', 403)
        passed(
            'policy changes reconcile every assigned host and disabled assignments still prevent deletion',
        )

        const policyUsername = 'smoke-user'
        const firstPassword = 'First-smoke-password:one'
        const rotatedPassword = 'Rotated-smoke-password:two'
        async function expectBasicAccess(
            domain: string,
            username: string,
            password: string,
            expectedStatus: number,
        ): Promise<void> {
            const response = await fetch(proxyUrl + '/basic-auth', {
                headers: {
                    host: domain,
                    authorization: basicHeader(username, password),
                    'x-forwarded-for': '127.0.0.1',
                },
                signal: AbortSignal.timeout(5_000),
            })
            assert.equal(response.status, expectedStatus)
            if (expectedStatus === 200) {
                const result = await response.json()
                assert.equal(result.message, 'upstream-one')
                assert.equal(result.hasAuthorization, false)
            } else {
                if (expectedStatus === 401) {
                    assert.match(response.headers.get('www-authenticate') ?? '', /^Basic /u)
                }
                await response.body?.cancel()
            }
        }
        const account = await authorized(() =>
            basicAuthServices.createBasicAuthAccountService({
                accessPolicyId: policy.id,
                username: policyUsername,
                password: firstPassword,
            }),
        )
        assert.equal(account.runtimeStatus, 'applied')
        await expectProxyStatus('policy.test', 401)
        await expectBasicAccess('policy.test', policyUsername, 'wrong-password', 401)
        await expectBasicAccess('policy.test', policyUsername, firstPassword, 200)
        await expectBasicAccess('policy-two.test', policyUsername, firstPassword, 200)
        await expectWebSocketUpgrade('policy.test', basicHeader(policyUsername, firstPassword))
        const secondAccount = await authorized(() =>
            basicAuthServices.createBasicAuthAccountService({
                accessPolicyId: policy.id,
                username: 'second-user',
                password: 'Second-smoke-password',
            }),
        )
        const accounts = await authorized(() =>
            basicAuthServices.getBasicAuthAccountsService({ accessPolicyId: policy.id }),
        )
        assert.equal(accounts.length, 2)
        assert.equal(JSON.stringify(accounts).includes(firstPassword), false)
        assert.equal(JSON.stringify(accounts).includes('passwordHash'), false)
        assert.equal(JSON.stringify(accounts).includes('$argon2'), false)
        await expectBasicAccess('policy.test', 'second-user', 'Second-smoke-password', 200)
        await authorized(() =>
            basicAuthServices.updateBasicAuthAccountService({
                accessPolicyId: policy.id,
                accountId: account.accountId,
                password: rotatedPassword,
            }),
        )
        await expectBasicAccess('policy.test', policyUsername, firstPassword, 401)
        await expectBasicAccess('policy.test', policyUsername, rotatedPassword, 200)
        await authorized(() =>
            basicAuthServices.deleteBasicAuthAccountService({
                accessPolicyId: policy.id,
                accountId: secondAccount.accountId,
            }),
        )
        await expectBasicAccess('policy.test', 'second-user', 'Second-smoke-password', 401)
        passed(
            'Basic Auth enforces shared credentials, WebSockets, rotation and removal without exposing hashes',
        )

        const initialSnapshot = await runtime.getProxyRuntimeSnapshotService()
        assert.equal(initialSnapshot.version, 7)
        assert.equal(
            (await controller.getProxyRuntimeStatus())?.activeRevision,
            initialSnapshot.revision,
        )
        passed('v7 snapshot is canonical and active without expert runtime directives')
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
            ...(host.accessPolicy
                ? { accessPolicy: { ...host.accessPolicy, mode: 'public', combination: null } }
                : {}),
        }))
        const unresolvableCanonical = JSON.stringify({
            version: 7,
            proxyHosts: unresolvableHosts,
            redirectHosts: snapshot.redirectHosts,
            httpSettings: snapshot.httpSettings,
            trustedCas: snapshot.trustedCas,
        })
        // Caddy deliberately does not resolve upstream DNS while loading JSON. Block its
        // internal Unix listener instead, which is a real, controlled bind failure.
        const probeSocket = '/var/lib/rentnerproxy/proxy/runtime-probe.sock'
        await command([
            ...compose,
            'exec',
            '-T',
            'proxy-runtime',
            'sh',
            '-c',
            `rm -f ${probeSocket} && printf probe-blocker > ${probeSocket}`,
        ])
        let rejectedCandidate: Response
        try {
            rejectedCandidate = await fetch(controllerUrl + '/internal/v1/proxy/config', {
                method: 'PUT',
                headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
                body: JSON.stringify({
                    version: 7,
                    revision:
                        'sha256:' +
                        new Bun.CryptoHasher('sha256').update(unresolvableCanonical).digest('hex'),
                    proxyHosts: unresolvableHosts,
                    redirectHosts: snapshot.redirectHosts,
                    httpSettings: snapshot.httpSettings,
                    trustedCas: snapshot.trustedCas,
                }),
                signal: AbortSignal.timeout(20_000),
            })
        } finally {
            await command([...compose, 'exec', '-T', 'proxy-runtime', 'rm', '-f', probeSocket])
        }
        assert.equal(rejectedCandidate.status, 502)
        assert.equal((await rejectedCandidate.json()).error, 'apply_failed')
        assert.equal((await controller.getProxyRuntimeStatus())?.activeRevision, snapshot.revision)
        await expectProxyMessage('demo.test', 'upstream-two')
        await expectProxyStatus('policy.test', 401)
        await expectProxyStatus('policy-two.test', 401)
        await expectBasicAccess('policy.test', policyUsername, rotatedPassword, 200)
        passed(
            'controlled Caddy probe bind failure preserves the active revision and working backend',
        )

        const activeConfigResponse = await fetch(controllerUrl + '/internal/v1/proxy/config', {
            headers: { authorization: 'Bearer ' + token },
        })
        assert.equal(activeConfigResponse.status, 200)
        const activeConfigPayload = (await activeConfigResponse.json()) as {
            readonly config?: unknown
        }
        assert.equal(typeof activeConfigPayload.config, 'string')
        assert.equal((activeConfigPayload.config as string).includes('$argon2'), false)
        assert.equal((activeConfigPayload.config as string).includes(rotatedPassword), false)
        const adminConfig = JSON.parse(activeConfigPayload.config as string) as Record<string, any>
        const httpServers = adminConfig.apps?.http?.servers
        const httpServer = httpServers?.['rentnerproxy-http']
        assert.ok(Array.isArray(httpServer?.routes))
        assert.ok(httpServer.routes.length > 0)
        assert.ok(Array.isArray(httpServer.routes[0].handle))
        httpServer.routes[0].handle[0] = { handler: 'rentnerproxy_unknown_smoke_handler' }
        const adminConfigBase64 = Buffer.from(JSON.stringify(adminConfig)).toString('base64')
        const adminLoadResult = await command([
            ...compose,
            'exec',
            '-T',
            '--user',
            '10001:10001',
            'proxy-runtime',
            'sh',
            '-c',
            `printf '%s' '${adminConfigBase64}' | base64 -d > /tmp/rentnerproxy-admin-reject.json && curl --silent --output /dev/null --write-out 'HTTP_STATUS:%{http_code}' --request POST --header 'content-type: application/json' --data-binary @/tmp/rentnerproxy-admin-reject.json --unix-socket /var/lib/rentnerproxy/proxy/caddy-admin.sock http://localhost/load; rm -f /tmp/rentnerproxy-admin-reject.json`,
        ])
        assert.match(adminLoadResult, /HTTP_STATUS:400/u)
        assert.equal((await controller.getProxyRuntimeStatus())?.running, true)
        assert.equal((await controller.getProxyRuntimeStatus())?.activeRevision, snapshot.revision)
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('native Caddy admin rejection preserves the active revision and working backend')

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
        await expectProxyStatus('policy.test', 401)
        await expectProxyStatus('policy-two.test', 401)
        await expectBasicAccess('policy.test', policyUsername, firstPassword, 401)
        await expectBasicAccess('policy.test', policyUsername, rotatedPassword, 200)
        passed('protected Access Policies survive failed relaxation and controller restart')

        await command([...compose, 'exec', '-T', 'proxy-runtime', 'pkill', '-TERM', 'caddy'])
        await waitFor(
            async () => (await controller.getProxyRuntimeStatus())?.running === false,
            'Caddy shutdown',
        )
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
        passed('Caddy readiness dip: controller and desired-state reads remain available')

        await waitFor(async () => {
            const status = await controller.getProxyRuntimeStatus()
            return status?.running === true && status.activeRevision === snapshot.revision
        }, 'automatic recovery after Caddy shutdown')
        await expectProxyMessage('demo.test', 'upstream-two')
        passed('controller automatically recovers Caddy and retains the last working configuration')

        await authorized(() =>
            basicAuthServices.deleteBasicAuthAccountService({
                accessPolicyId: policy.id,
                accountId: account.accountId,
            }),
        )
        await expectProxyStatus('policy.test', 403)
        await expectBasicAccess('policy.test', policyUsername, rotatedPassword, 403)
        passed('removing the last Basic Auth account closes the policy instead of opening the host')
        await authorized(() => services.deleteProxyHostService(secondPolicyHost.id))
        await authorized(() =>
            services.updateProxyHostService({
                ...policyHostInput,
                proxyHostId: policyHost.id,
                accessPolicyId: null,
            }),
        )
        await expectProxyMessage('policy.test', 'upstream-one')
        await authorized(() => policyServices.deleteAccessPolicyService(policy.accessPolicyId))
        await authorized(() => services.deleteProxyHostService(policyHost.id))
        passed('explicit policy removal reconciles public access before deleting the unused policy')

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
        await waitFor(
            async () =>
                (await authorized(() => runtime.getProxyRuntimeStatusService())).state === 'synced',
            'automatic reconciliation after controller recovery',
            75_000,
        )
        await expectProxyStatus('offline.test', 200)
        assert.equal(
            (await authorized(() => runtime.getProxyRuntimeStatusService())).state,
            'synced',
        )
        passed('owned retry reconciles saved changes after controller recovery without user action')

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

        await command([...compose, 'stop', 'proxy-runtime'])
        const startupPending = await authorized(() =>
            services.createProxyHostService({ ...hostInput, domains: ['startup.test'] }),
        )
        assert.equal(startupPending.runtimeStatus, 'pending')
        await runtime.stopProxyRuntimeReconciliation()
        await command([...compose, 'start', 'proxy-runtime'])
        await refreshRuntimeAddresses()

        const restartWorker = join(temporaryComposeDirectory, 'restart-worker.ts')
        const serviceUrl = pathToFileURL(
            join(repositoryRoot, 'web/src/server/ProxyRuntime/proxy-runtime.service.ts'),
        ).href
        const controllerClientUrl = pathToFileURL(
            join(repositoryRoot, 'web/src/server/Foundation/controller.server.ts'),
        ).href
        const databaseModuleUrl = pathToFileURL(
            join(repositoryRoot, 'web/src/server/Auth/Core/database.server.ts'),
        ).href
        await writeFile(
            restartWorker,
            `const runtime = await import(${JSON.stringify(serviceUrl)});
const controller = await import(${JSON.stringify(controllerClientUrl)});
const { getAuthDatabase } = await import(${JSON.stringify(databaseModuleUrl)});
runtime.startProxyRuntimeReconciliation();
try {
    const deadline = Date.now() + 75000;
    let synced = false;
    while (Date.now() < deadline) {
        const desired = await runtime.getProxyRuntimeSnapshotService();
        const active = await controller.getProxyRuntimeStatus();
        if (active?.running && active.activeRevision === desired.revision) { synced = true; break; }
        await Bun.sleep(150);
    }
    if (!synced) throw new Error('Startup reconciliation did not converge.');
} finally {
    await runtime.stopProxyRuntimeReconciliation();
    await getAuthDatabase().$client.close();
}
`,
        )
        await command([process.execPath, restartWorker], { timeoutMs: 90_000 })
        await expectProxyStatus('startup.test', 200)
        passed(
            'a new Web worker process heals persisted pending state at startup without an apply request',
        )

        console.log('Real Caddy proxy integration: ' + assertions + ' checks passed.')
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
        if (stopReconciliation) await stopReconciliation().catch(() => undefined)
        await first.stop(true)
        await second.stop(true)
        if (closeDatabase) await closeDatabase().catch(() => undefined)
        // These names are generated above for this run; no existing dev volume/database is touched.
        await command([...compose, 'down', '--volumes', '--remove-orphans']).catch(() => undefined)
        await command(['docker', 'rm', '--force', '--volumes', databaseContainer]).catch(
            () => undefined,
        )
        await rm(temporaryComposeDirectory, { force: true, recursive: true })
    }
}

await runSmoke()
