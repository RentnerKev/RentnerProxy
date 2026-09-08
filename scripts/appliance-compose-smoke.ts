// oxlint-disable no-await-in-loop -- Readiness probes deliberately poll in a bounded sequence.

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { smokeCompose, smokeDockerArguments } from './smoke-resources'

// This smoke deliberately uses a separate env file. Compose otherwise auto-loads the
// repository .env, which may contain real SMTP credentials on a developer machine.
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const rootComposeFile = join(repositoryRoot, 'docker-compose.yml')
const productionDockerfile = join(repositoryRoot, 'docker', 'production', 'Dockerfile')
const runId = randomUUID().replaceAll('-', '').slice(0, 12)
const project = 'rentnerproxy-appliance-smoke-' + runId
const smtpEnvironment = {
    SMTP_FROM: 'RentnerProxy <noreply@appliance-smoke.invalid>',
    SMTP_HOST: 'smtp.appliance-smoke.invalid',
    SMTP_PASSWORD: 'appliance-smoke-password-' + runId,
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'appliance-smoke-user',
} as const
const smtpNames = Object.keys(smtpEnvironment).toSorted()
const commandEnvironment: NodeJS.ProcessEnv = { ...process.env }
for (const variable of smtpNames) delete commandEnvironment[variable]
for (const variable of [
    'APP_ENCRYPTION_KEY',
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
    'RENTNERPROXY_APP_KEY_FILE',
    'RENTNERPROXY_CONTROLLER_TOKEN',
]) {
    delete commandEnvironment[variable]
}

let assertions = 0

function passed(label: string): void {
    assertions += 1
    console.log('PASS ' + label)
}

async function command(argumentsList: string[], timeoutMs = 120_000): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(argumentsList),
        cwd: repositoryRoot,
        env: commandEnvironment,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output, errorOutput] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) {
            throw new Error('smoke command failed: ' + argumentsList.slice(0, 2).join(' '))
        }
        return (output || errorOutput).trim()
    } finally {
        clearTimeout(timer)
    }
}

async function commandWithEnvironment(
    argumentsList: string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs = 120_000,
): Promise<string> {
    const child = Bun.spawn({
        cmd: smokeDockerArguments(argumentsList),
        cwd: repositoryRoot,
        env: environment,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const stdout =
        child.stdout && typeof child.stdout !== 'number'
            ? new Response(child.stdout).text()
            : Promise.resolve('')
    const stderr =
        child.stderr && typeof child.stderr !== 'number'
            ? new Response(child.stderr).text()
            : Promise.resolve('')

    try {
        const [exitCode, output, errorOutput] = await Promise.all([child.exited, stdout, stderr])
        if (exitCode !== 0) {
            throw new Error('smoke command failed: ' + argumentsList.slice(0, 2).join(' '))
        }
        return (output || errorOutput).trim()
    } finally {
        clearTimeout(timer)
    }
}

async function commandFails(argumentsList: string[], timeoutMs = 120_000): Promise<boolean> {
    try {
        await command(argumentsList, timeoutMs)
        return false
    } catch {
        return true
    }
}

async function waitFor(
    check: () => Promise<boolean>,
    label: string,
    timeoutMs = 120_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if (await check()) return
        } catch {
            // The container may be between creation, start, and health transitions.
        }
        await Bun.sleep(500)
    }
    throw new Error('timed out waiting for ' + label)
}

async function availableLoopbackPort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer()
        server.unref()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (!address || typeof address === 'string') {
                server.close()
                reject(new Error('failed to allocate a loopback port'))
                return
            }
            const port = address.port
            server.close((error) => {
                if (error) reject(error)
                else resolvePort(port)
            })
        })
    })
}

function composeCommand(envFile: string, composeFile: string, projectName = project): string[] {
    return [
        'docker',
        'compose',
        '--env-file',
        envFile,
        '--project-name',
        projectName,
        '--file',
        composeFile,
    ]
}

async function containerId(compose: string[]): Promise<string> {
    const id = await command([...compose, 'ps', '--all', '--quiet', 'rentnerproxy'])
    assert.ok(id, 'rentnerproxy container is missing')
    return id
}

async function inspect(id: string, format: string): Promise<string> {
    return command(['docker', 'inspect', '--format', format, id])
}

async function containerHealth(id: string): Promise<string> {
    return inspect(
        id,
        '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.State.ExitCode}}',
    )
}

async function waitForHealthy(id: string): Promise<void> {
    await waitFor(
        async () => (await containerHealth(id)).includes('|healthy|'),
        'rentnerproxy healthy',
        240_000,
    )
}

async function httpStatus(url: string): Promise<{ status: number; body: string }> {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    const body = await response.text()
    return { status: response.status, body }
}

async function controllerCall(
    id: string,
    path: string,
    method: string,
    body?: unknown,
): Promise<{ status: number; body: string }> {
    const encodedBody = body === undefined ? '' : JSON.stringify(body)
    const source = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const response=await fetch('http://127.0.0.1:8081${path}',{method:${JSON.stringify(method)},headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:${JSON.stringify(encodedBody)} });process.stdout.write(JSON.stringify({status:response.status,body:await response.text()}));`
    return JSON.parse(
        await command(['docker', 'exec', '--user', '10001:10001', id, 'bun', '-e', source]),
    ) as { status: number; body: string }
}

function digest(value: string | Uint8Array): string {
    return createHash('sha256').update(value).digest('hex')
}

function assertLoopbackListeners(procNet: string, port: number): void {
    const portHex = port.toString(16).toUpperCase().padStart(4, '0')
    const listeners = procNet
        .split(/\r?\n/u)
        .map((line) => line.trim().split(/\s+/u))
        .filter((fields) => fields.length >= 4 && fields[3] === '0A')
        .map((fields) => fields[1]!.split(':'))
        .filter(([, localPort]) => localPort === portHex)

    assert.ok(listeners.length > 0, 'expected a listener on loopback port ' + port)
    for (const [address] of listeners) {
        assert.ok(
            address === '0100007F' ||
                address === '0000000000000000FFFF00000100007F' ||
                address === '00000000000000000000000001000000',
            'non-loopback listener found on port ' + port,
        )
    }
}

async function runSmoke(): Promise<void> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'rentnerproxy-appliance-smoke-'))
    const envFile = join(temporaryRoot, 'smtp.env')
    const temporaryComposeFile = join(temporaryRoot, 'docker-compose.yml')
    const imageTag = 'rentnerproxy-appliance-smoke:' + runId
    const volumeName = project + '-data'
    // PostgreSQL's base image declares this unused volume in addition to our real PGDATA.
    // Give it an owned name so Compose recreation/restore cannot orphan anonymous volumes.
    const inheritedVolumeName = project + '-postgres-base'
    const [httpPort, managementPort, httpsPort] = await Promise.all([
        availableLoopbackPort(),
        availableLoopbackPort(),
        availableLoopbackPort(),
    ])
    await writeFile(
        envFile,
        smtpNames
            .map((name) => `${name}=${smtpEnvironment[name as keyof typeof smtpEnvironment]}`)
            .join('\n') + '\n',
        'utf8',
    )
    const rootCompose = await readFile(rootComposeFile, 'utf8')
    const temporaryCompose = smokeCompose(
        rootCompose
            .replace(
                'services:\n    rentnerproxy:\n',
                'services:\n    rentnerproxy:\n        extra_hosts:\n            - host.docker.internal:host-gateway\n',
            )
            .replace('ghcr.io/rentnerkev/rentnerproxy:latest', imageTag)
            .replace("- '80:8080'", `- '127.0.0.1:${httpPort}:8080'`)
            .replace("- '127.0.0.1:81:3000'", `- '127.0.0.1:${managementPort}:3000'`)
            .replace("- '443:8443'", `- '127.0.0.1:${httpsPort}:8443'`)
            .replace(
                '- rentnerproxy:/var/lib/rentnerproxy',
                `- ${volumeName}:/var/lib/rentnerproxy\n            - ${inheritedVolumeName}:/var/lib/postgresql`,
            )
            .replace(
                '\nvolumes:\n    rentnerproxy:\n',
                `\nvolumes:\n    ${volumeName}:\n    ${inheritedVolumeName}:\n`,
            ),
    )
    assert.notEqual(
        temporaryCompose,
        rootCompose,
        'temporary appliance Compose was not transformed',
    )
    await writeFile(temporaryComposeFile, temporaryCompose, 'utf8')
    const compose = composeCommand(envFile, temporaryComposeFile)
    const restoreProject = project + '-restore'
    const restoreCompose = composeCommand(envFile, temporaryComposeFile, restoreProject)
    const legacyProjects = [project + '-legacy-v2', project + '-legacy-v1']
    const legacyComposes = legacyProjects.map((name) =>
        composeCommand(envFile, temporaryComposeFile, name),
    )
    let backend: ReturnType<typeof Bun.serve> | undefined
    const scriptEnvironment: NodeJS.ProcessEnv = {
        ...commandEnvironment,
        ...smtpEnvironment,
        RENTNERPROXY_COMPOSE_FILE: temporaryComposeFile,
    }

    try {
        await command(
            ['docker', 'build', '--tag', imageTag, '--file', productionDockerfile, '.'],
            900_000,
        )
        const rendered = JSON.parse(await command([...compose, 'config', '--format', 'json'])) as {
            services: Record<
                string,
                {
                    environment?: Record<string, string>
                    image?: string
                    ports?: Array<{ published: string; target: number }>
                    volumes?: Array<{ source?: string; target: string }>
                    cap_drop?: string[]
                    cap_add?: string[]
                    security_opt?: string[]
                }
            >
            volumes?: Record<string, unknown>
        }
        assert.deepEqual(Object.keys(rendered.services), ['rentnerproxy'])
        const service = rendered.services.rentnerproxy
        assert.ok(service)
        assert.equal(service.image, imageTag)
        assert.deepEqual(Object.keys(service.environment ?? {}).toSorted(), smtpNames)
        assert.deepEqual(
            (service.ports ?? []).map(({ published, target }) => ({ published, target })),
            [
                { published: String(httpPort), target: 8080 },
                { published: String(managementPort), target: 3000 },
                { published: String(httpsPort), target: 8443 },
            ],
        )
        assert.deepEqual(
            Object.keys(rendered.volumes ?? {}).toSorted(),
            [volumeName, inheritedVolumeName].toSorted(),
        )
        assert.deepEqual(
            (service.volumes ?? [])
                .map(({ source, target }) => ({ source, target }))
                .toSorted((a, b) => a.target.localeCompare(b.target)),
            [
                { source: inheritedVolumeName, target: '/var/lib/postgresql' },
                { source: volumeName, target: '/var/lib/rentnerproxy' },
            ],
        )
        assert.deepEqual(service.cap_drop, ['ALL'])
        assert.deepEqual(service.cap_add?.toSorted(), [
            'CHOWN',
            'DAC_OVERRIDE',
            'FOWNER',
            'KILL',
            'SETGID',
            'SETUID',
        ])
        assert.ok(service.security_opt?.includes('no-new-privileges:true'))
        passed('appliance Compose keeps private management and minimal bootstrap capabilities')

        await commandFails([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await command([...compose, 'up', '--detach'], 900_000)
        const id = await containerId(compose)
        await waitForHealthy(id)
        const mounts = JSON.parse(await inspect(id, '{{json .Mounts}}')) as Array<{
            Type: string
            Name: string
            Destination: string
        }>
        assert.deepEqual(
            mounts
                .map(({ Type, Name, Destination }) => ({ Type, Name, Destination }))
                .toSorted((a, b) => a.Destination.localeCompare(b.Destination)),
            [
                {
                    Type: 'volume',
                    Name: project + '_' + inheritedVolumeName,
                    Destination: '/var/lib/postgresql',
                },
                {
                    Type: 'volume',
                    Name: project + '_' + volumeName,
                    Destination: '/var/lib/rentnerproxy',
                },
            ],
            'every appliance volume must belong to this smoke; anonymous volumes cannot be recovered by run label',
        )
        passed('empty appliance volume builds and starts healthy')
        assert.equal(
            await command(['docker', 'exec', id, 'sha256sum', '/usr/share/licenses/caddy/LICENSE']),
            // Git may check this file out with LF or CRLF. The image must contain those exact bytes.
            digest(await readFile(join(repositoryRoot, 'docker', 'licenses', 'Caddy-LICENSE'))) +
                '  /usr/share/licenses/caddy/LICENSE',
        )
        passed('redistributed Caddy binary includes the exact Apache-2.0 license')
        const roleState = await command([
            'docker',
            'exec',
            id,
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=postgres',
            '--tuples-only',
            '--no-align',
            '--command',
            "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = 'rentnerproxy'; SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'rentnerproxy'; SELECT rolpassword IS NULL FROM pg_authid WHERE rolname = 'postgres';",
        ])
        assert.deepEqual(roleState.split(/\r?\n/u), ['f|f|f|f|f', 'rentnerproxy', 't'])
        assert.equal(
            await command(['docker', 'exec', id, 'stat', '-c', '%a:%U', '/var/run/postgresql']),
            '700:postgres',
        )
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                '--user',
                '10001:10001',
                id,
                'psql',
                '--no-psqlrc',
                '--no-password',
                '--host=/var/run/postgresql',
                '--username=postgres',
                '--dbname=postgres',
                '--command=SELECT 1',
            ]),
        )
        passed(
            'application database role has no administrative privileges and cannot use bootstrap socket',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'stat',
                '-c',
                '%a:%U:%G',
                '/run/rentnerproxy/app-key/value',
            ]),
            '400:rentnerproxy-web:rentnerproxy-web',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'stat',
                '-c',
                '%a:%U:%G',
                '/run/rentnerproxy/database-url/value',
            ]),
            '400:rentnerproxy-web:rentnerproxy-web',
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                id,
                'stat',
                '-c',
                '%a:%U:%G',
                '/run/rentnerproxy/controller-token/value',
            ]),
            '440:rentnerproxy:rentnerproxy-web',
        )
        const boundarySecret = '/var/lib/rentnerproxy/proxy/appliance-boundary-secret'
        await command([
            'docker',
            'exec',
            '--user',
            '10001:10001',
            id,
            'sh',
            '-c',
            `umask 077; printf boundary-secret > ${boundarySecret}`,
        ])
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                id,
                'gosu',
                'rentnerproxy-web',
                'cat',
                boundarySecret,
            ]),
        )
        assert.ok(
            await commandFails([
                'docker',
                'exec',
                id,
                'gosu',
                'rentnerproxy-web',
                'curl',
                '--silent',
                '--fail',
                '--unix-socket',
                '/var/lib/rentnerproxy/proxy/caddy-admin.sock',
                'http://localhost/config/',
            ]),
        )
        passed(
            'web can read only its input secrets and cannot read proxy state or open Caddy admin',
        )

        const setup = await httpStatus('http://127.0.0.1:' + managementPort + '/setup')
        assert.equal(setup.status, 200)
        assert.match(setup.body, /setup|RentnerProxy/iu)
        const entryAsset = setup.body.match(/<script[^>]+src="([^"]+\.js)"/iu)?.[1]
        assert.ok(entryAsset)
        const entryAssetResponse = await httpStatus(
            'http://127.0.0.1:' + managementPort + entryAsset,
        )
        assert.equal(entryAssetResponse.status, 200)
        passed('SSR setup entry module is served for client hydration')
        const live = await httpStatus('http://127.0.0.1:' + managementPort + '/health/live')
        assert.equal(live.status, 200)
        assert.deepEqual(JSON.parse(live.body), { status: 'ok' })
        const ready = await httpStatus('http://127.0.0.1:' + managementPort + '/health/ready')
        assert.equal(ready.status, 200)
        assert.deepEqual(JSON.parse(ready.body), { status: 'ready' })
        const proxy = await httpStatus('http://127.0.0.1:' + httpPort + '/')
        assert.ok(proxy.status >= 200 && proxy.status < 500)
        passed('setup, liveness, readiness, and proxy HTTP endpoints respond')
        // Send headers only: Bun rejects the declared size before receiving a large body.
        // Fetch can surface a socket error if it is still uploading when that rejection closes it.
        const oversizedStatus = await new Promise<number | undefined>((resolveStatus, reject) => {
            const request = httpRequest(
                'http://127.0.0.1:' + managementPort + '/health/live',
                {
                    method: 'POST',
                    headers: { 'Content-Length': String(12 * 1024 * 1024 + 1) },
                },
                (response) => {
                    response.resume()
                    resolveStatus(response.statusCode)
                },
            )
            request.on('error', reject)
            request.setTimeout(5_000, () =>
                request.destroy(new Error('body-limit probe timed out')),
            )
            request.end()
        })
        assert.equal(oversizedStatus, 413)
        passed('web listener rejects oversized request bodies before application processing')

        const portBindings = JSON.parse(
            await inspect(id, '{{json .HostConfig.PortBindings}}'),
        ) as Record<string, unknown> | null
        assert.deepEqual(Object.keys(portBindings ?? {}).toSorted(), [
            '3000/tcp',
            '8080/tcp',
            '8443/tcp',
        ])
        const procNet = await command([
            'docker',
            'exec',
            id,
            'sh',
            '-c',
            'cat /proc/net/tcp /proc/net/tcp6',
        ])
        assertLoopbackListeners(procNet, 5432)
        assertLoopbackListeners(procNet, 6379)
        assertLoopbackListeners(procNet, 8081)
        passed('database, Redis, and controller are unpublished and loopback-only')

        const environment = JSON.parse(await inspect(id, '{{json .Config.Env}}')) as string[]
        for (const name of smtpNames) {
            assert.ok(
                environment.includes(
                    `${name}=${smtpEnvironment[name as keyof typeof smtpEnvironment]}`,
                ),
            )
        }
        passed('dummy SMTP configuration reaches the appliance container')

        const generatedSecrets = JSON.parse(
            await command([
                'docker',
                'exec',
                id,
                'bun',
                '-e',
                'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
            ]),
        ) as Record<string, string>
        const secretNames = [
            'appEncryptionKey',
            'controllerToken',
            'databaseUrl',
            'postgresPassword',
        ]
        for (const name of secretNames) assert.equal(typeof generatedSecrets[name], 'string')
        assert.match(generatedSecrets.postgresPassword!, /^[a-f0-9]{64}$/u)
        assert.match(generatedSecrets.controllerToken!, /^[a-f0-9]{64}$/u)
        assert.match(generatedSecrets.appEncryptionKey!, /^[A-Za-z0-9+/]{43}=$/u)
        const generatedSecretDigests = Object.fromEntries(
            secretNames.map((name) => [name, digest(generatedSecrets[name]!)]),
        )
        const image = await inspect(id, '{{.Image}}')
        const imageHistory = await command([
            'docker',
            'history',
            '--no-trunc',
            '--format',
            '{{.CreatedBy}}',
            image,
        ])
        const stackLogs = await command([...compose, 'logs', '--no-color'])
        for (const name of secretNames) {
            const secret = generatedSecrets[name]!
            assert.equal(imageHistory.includes(secret), false, name + ' leaked into image history')
            assert.equal(
                environment.some((entry) => entry.includes(secret)),
                false,
                name + ' leaked into container environment',
            )
            assert.equal(stackLogs.includes(secret), false, name + ' leaked into container logs')
        }
        passed('generated secrets stay out of image history, container env, and logs')

        const marker = 'appliance-smoke-' + runId
        await command([
            'docker',
            'exec',
            id,
            'sh',
            '-c',
            `printf %s ${marker} > /var/lib/rentnerproxy/appliance-smoke-marker; PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="CREATE TABLE IF NOT EXISTS appliance_compose_smoke (marker text PRIMARY KEY); INSERT INTO appliance_compose_smoke (marker) VALUES ('${marker}') ON CONFLICT DO NOTHING;" >/dev/null`,
        ])
        const markerDigest = await command([
            'docker',
            'exec',
            id,
            'sha256sum',
            '/var/lib/rentnerproxy/appliance-smoke-marker',
        ])
        await command([...compose, 'up', '--force-recreate', '--detach'])
        const recreatedId = await containerId(compose)
        await waitForHealthy(recreatedId)
        const recreatedSecrets = JSON.parse(
            await command([
                'docker',
                'exec',
                recreatedId,
                'bun',
                '-e',
                'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
            ]),
        ) as Record<string, string>
        assert.deepEqual(
            Object.fromEntries(secretNames.map((name) => [name, digest(recreatedSecrets[name]!)])),
            generatedSecretDigests,
        )
        assert.equal(
            await command([
                'docker',
                'exec',
                recreatedId,
                'sha256sum',
                '/var/lib/rentnerproxy/appliance-smoke-marker',
            ]),
            markerDigest,
        )
        const restoredMarker = await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
        ])
        assert.equal(restoredMarker, marker)
        passed('container recreation preserves generated secrets, volume state, and database state')

        // Exercise the appliance path with a real managed certificate and a real host backend.
        // The backend is deliberately outside the appliance, while host.docker.internal keeps
        // this smoke isolated from any developer service running on the machine.
        const backendPort = await availableLoopbackPort()
        const trafficMarker = 'appliance-real-traffic-' + runId
        backend = Bun.serve({
            hostname: '0.0.0.0',
            port: backendPort,
            fetch: () => new Response(trafficMarker),
        })
        assert.ok(backend.port)
        const hostDomain = 'appliance-' + runId + '.test'
        const certificateId = '0198d98a-0000-7000-8000-' + runId
        const hostId = '0198d98a-0000-7000-8000-' + runId.slice(0, 11) + 'a'
        const certificateDirectory = '/tmp/rentnerproxy-appliance-certificate'
        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `set -Eeuo pipefail; rm -rf ${certificateDirectory}; mkdir -p ${certificateDirectory}; openssl req -x509 -newkey rsa:2048 -nodes -keyout ${certificateDirectory}/ca.key -out ${certificateDirectory}/ca.pem -days 1 -subj /CN=RentnerProxy-Appliance-CA; openssl req -new -newkey rsa:2048 -nodes -keyout ${certificateDirectory}/leaf.key -out ${certificateDirectory}/leaf.csr -subj /CN=${hostDomain}; printf 'subjectAltName=DNS:${hostDomain}\\nextendedKeyUsage=serverAuth\\nbasicConstraints=critical,CA:FALSE\\nkeyUsage=critical,digitalSignature,keyEncipherment\\n' > ${certificateDirectory}/leaf.ext; openssl x509 -req -in ${certificateDirectory}/leaf.csr -CA ${certificateDirectory}/ca.pem -CAkey ${certificateDirectory}/ca.key -CAcreateserial -out ${certificateDirectory}/leaf.pem -days 1 -sha256 -extfile ${certificateDirectory}/leaf.ext; chown -R 10001:10001 ${certificateDirectory}`,
        ])
        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="INSERT INTO rentnerproxy.certificates (id, name, source, status, operation) VALUES ('${certificateId}', 'Appliance smoke certificate', 'manual', 'pending', 'idle');" >/dev/null`,
        ])
        const importSource = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const certificatePem=await Bun.file('${certificateDirectory}/leaf.pem').text();const privateKeyPem=await Bun.file('${certificateDirectory}/leaf.key').text();const chainPem=await Bun.file('${certificateDirectory}/ca.pem').text();const response=await fetch('http://127.0.0.1:8081/internal/v1/certificates/${certificateId}/import',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({certificatePem,privateKeyPem,chainPem,requiredDomains:['${hostDomain}']})});process.stdout.write(String(response.status));if(response.status!==200)process.exit(1);`
        assert.equal(
            await command([
                'docker',
                'exec',
                '--user',
                '10001:10001',
                recreatedId,
                'bun',
                '-e',
                importSource,
            ]),
            '200',
        )
        const insertHostSql = `INSERT INTO rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, certificate_id, force_https, verify_upstream_tls) VALUES ('${hostId}', 'http', 'host.docker.internal', ${backendPort}, true, '${certificateId}', false, true); INSERT INTO rentnerproxy.host_domains (id, proxy_host_id, domain) VALUES ('0198d98a-0000-7000-8000-${runId.slice(0, 11)}b', '${hostId}', '${hostDomain}');`
        await command([
            'docker',
            'exec',
            recreatedId,
            'sh',
            '-c',
            `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="${insertHostSql}" >/dev/null`,
        ])
        const realConfig = {
            version: 7,
            proxyHosts: [
                {
                    id: hostId,
                    domains: [hostDomain],
                    forwardScheme: 'http',
                    forwardHost: 'host.docker.internal',
                    forwardPort: backendPort,
                    certificateId,
                },
            ],
            redirectHosts: [],
            httpSettings: {},
            trustedCas: [],
        }
        const realConfigCanonical = JSON.stringify(realConfig)
        const realConfigWithRevision = {
            ...realConfig,
            revision: 'sha256:' + digest(realConfigCanonical),
        }
        const realApply = await controllerCall(
            recreatedId,
            '/internal/v1/proxy/config',
            'PUT',
            realConfigWithRevision,
        )
        assert.equal(realApply.status, 200)
        await waitFor(async () => {
            const status = await controllerCall(recreatedId, '/internal/v1/proxy/status', 'GET')
            return status.status === 200 && status.body.includes(realConfigWithRevision.revision)
        }, 'managed certificate configuration apply')
        const assertRealTraffic = async (container: string, label: string): Promise<void> => {
            const httpBody = await command([
                'docker',
                'exec',
                container,
                'curl',
                '--silent',
                '--show-error',
                '--noproxy',
                '*',
                '--header',
                'Host: ' + hostDomain,
                'http://127.0.0.1:8080/appliance-real-path',
            ])
            assert.equal(httpBody, trafficMarker)
            const httpsBody = await command([
                'docker',
                'exec',
                container,
                'curl',
                '--silent',
                '--show-error',
                '--noproxy',
                '*',
                '--insecure',
                '--resolve',
                hostDomain + ':8443:127.0.0.1',
                'https://' + hostDomain + ':8443/appliance-real-path',
            ])
            assert.equal(httpsBody, trafficMarker)
            passed(label)
        }
        await assertRealTraffic(
            recreatedId,
            'real HTTP and HTTPS managed-certificate traffic works',
        )
        await command([...compose, 'restart', 'rentnerproxy'])
        await waitForHealthy(recreatedId)
        await assertRealTraffic(
            recreatedId,
            'real HTTP and HTTPS traffic survives appliance restart',
        )

        const proxyBackupMarker = '/var/lib/rentnerproxy/proxy/appliance-backup-marker'
        await command([
            'docker',
            'exec',
            '--user',
            '10001:10001',
            recreatedId,
            'sh',
            '-c',
            `printf %s ${marker} > ${proxyBackupMarker}`,
        ])
        const proxyBackupMarkerDigest = await command([
            'docker',
            'exec',
            recreatedId,
            'sha256sum',
            proxyBackupMarker,
        ])
        const backupRoot = join(temporaryRoot, 'backups')
        await commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-backup.ts',
                '--project',
                project,
                '--output',
                backupRoot,
            ],
            scriptEnvironment,
            900_000,
        )
        await waitForHealthy(await containerId(compose))
        const backupEntries = await readdir(backupRoot)
        assert.equal(backupEntries.length, 1)
        const backupPath = join(backupRoot, backupEntries[0]!)
        const backupMetadata = JSON.parse(
            await readFile(join(backupPath, 'metadata.json'), 'utf8'),
        ) as {
            applicationEncryptionKey?: { file?: string }
            controllerState?: { archive?: string }
            redis?: string
            version?: number
        }
        assert.equal(backupMetadata.version, 3)
        assert.equal(backupMetadata.redis, 'excluded')
        assert.equal(backupMetadata.applicationEncryptionKey?.file, 'app-encryption-key')
        assert.equal(backupMetadata.controllerState?.archive, 'controller-state.tar')
        assert.equal(
            (await readFile(join(backupPath, 'app-encryption-key'), 'utf8')).trim(),
            generatedSecrets.appEncryptionKey,
        )

        await command([...compose, 'down', '--remove-orphans'], 180_000)
        await commandWithEnvironment(
            [
                process.execPath,
                'scripts/production-restore.ts',
                '--project',
                restoreProject,
                '--input',
                backupPath,
                '--confirm-replace',
            ],
            scriptEnvironment,
            900_000,
        )
        const restoredId = await containerId(restoreCompose)
        await waitForHealthy(restoredId)
        const disasterRestoreSecrets = JSON.parse(
            await command([
                'docker',
                'exec',
                restoredId,
                'bun',
                '-e',
                'const state = await Bun.file("/var/lib/rentnerproxy/bootstrap/secrets-v1.json").json(); process.stdout.write(JSON.stringify(state));',
            ]),
        ) as Record<string, string>
        assert.equal(disasterRestoreSecrets.appEncryptionKey, generatedSecrets.appEncryptionKey)
        assert.match(disasterRestoreSecrets.postgresPassword!, /^[a-f0-9]{64}$/u)
        assert.match(disasterRestoreSecrets.controllerToken!, /^[a-f0-9]{64}$/u)
        assert.equal(
            disasterRestoreSecrets.databaseUrl,
            `postgresql://rentnerproxy:${disasterRestoreSecrets.postgresPassword}@127.0.0.1:5432/rentnerproxy`,
        )
        assert.notEqual(disasterRestoreSecrets.postgresPassword, generatedSecrets.postgresPassword)
        assert.notEqual(disasterRestoreSecrets.controllerToken, generatedSecrets.controllerToken)
        assert.equal(
            await command([
                'docker',
                'exec',
                restoredId,
                'sh',
                '-c',
                `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --tuples-only --no-align --command="SELECT marker FROM appliance_compose_smoke WHERE marker = '${marker}';"`,
            ]),
            marker,
        )
        assert.equal(
            await command(['docker', 'exec', restoredId, 'sha256sum', proxyBackupMarker]),
            proxyBackupMarkerDigest,
        )
        passed(
            'backup restores PostgreSQL, controller state, and application identity to a fresh appliance',
        )
        await assertRealTraffic(
            restoredId,
            'v3 restore heals Caddy from desired DB and preserves HTTP/HTTPS traffic',
        )
        await command([
            'docker',
            'exec',
            restoredId,
            'rm',
            '-f',
            '/var/lib/rentnerproxy/bootstrap/secrets-v1.json',
        ])
        await command([...restoreCompose, 'restart', 'rentnerproxy'])
        await waitFor(
            async () => !(await containerHealth(restoredId)).includes('|healthy|'),
            'fail-closed startup after bootstrap state removal',
            150_000,
        )
        passed('removing bootstrap state while PostgreSQL data remains fails closed')
        await commandFails([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000)

        async function makeLegacyFixture(version: 1 | 2): Promise<string> {
            const fixture = join(temporaryRoot, 'backup-v' + version)
            await cp(backupPath, fixture, { recursive: true })
            const legacyDirectory = join(temporaryRoot, 'legacy-files-v' + version)
            await mkdir(join(legacyDirectory, 'host-configs'), { recursive: true })
            await writeFile(join(legacyDirectory, 'active.conf'), 'legacy active runtime\n')
            await writeFile(join(legacyDirectory, 'candidate.conf'), 'legacy candidate runtime\n')
            await writeFile(join(legacyDirectory, 'last-known-good.conf'), 'legacy last good\n')
            await writeFile(join(legacyDirectory, 'last-good.conf'), 'legacy last good alias\n')
            await writeFile(join(legacyDirectory, 'engine.pid'), '12345\n')
            await writeFile(
                join(legacyDirectory, 'host-configs', 'sidecar.conf'),
                'legacy sidecar\n',
            )
            await writeFile(
                join(legacyDirectory, 'active-proxy-snapshot.json'),
                JSON.stringify({ version: 6, legacy: true }) + '\n',
            )
            await command([
                'docker',
                'run',
                '--rm',
                '--entrypoint',
                'tar',
                '--volume',
                fixture + ':/backup',
                '--volume',
                legacyDirectory + ':/legacy:ro',
                imageTag,
                '--append',
                '--file=/backup/controller-state.tar',
                '--directory=/legacy',
                'active.conf',
                'candidate.conf',
                'last-known-good.conf',
                'last-good.conf',
                'engine.pid',
                'host-configs',
                'active-proxy-snapshot.json',
            ])
            const archivePath = join(fixture, 'controller-state.tar')
            const archiveBytes = await stat(archivePath)
            const metadataPath = join(fixture, 'metadata.json')
            const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as {
                controllerState: { bytes: number; sha256: string }
                version: number
            }
            metadata.version = version
            metadata.controllerState.bytes = archiveBytes.size
            metadata.controllerState.sha256 = digest(await readFile(archivePath))
            await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8')
            return fixture
        }

        async function restoreLegacyFixture(
            fixture: string,
            legacyCompose: string[],
            legacyProject: string,
            version: 1 | 2,
        ): Promise<void> {
            await commandFails([...legacyCompose, 'down', '--volumes', '--remove-orphans'], 180_000)
            const restoreArguments = [
                process.execPath,
                'scripts/production-restore.ts',
                '--project',
                legacyProject,
                '--input',
                fixture,
                '--confirm-replace',
            ]
            if (version === 1)
                restoreArguments.push('--app-key-file', join(fixture, 'app-encryption-key'))
            await commandWithEnvironment(restoreArguments, scriptEnvironment, 900_000)
            const legacyId = await containerId(legacyCompose)
            await waitForHealthy(legacyId)
            await assertRealTraffic(
                legacyId,
                'v' + version + ' legacy restore preserves HTTP/HTTPS traffic',
            )
            for (const entry of [
                'active.conf',
                'candidate.conf',
                'last-known-good.conf',
                'last-good.conf',
                'engine.pid',
                'host-configs',
                'active-proxy-snapshot.json',
            ]) {
                assert.ok(
                    await commandFails([
                        'docker',
                        'exec',
                        legacyId,
                        'test',
                        '!',
                        '-e',
                        '/var/lib/rentnerproxy/proxy/' + entry,
                    ]),
                    'legacy runtime state restored: ' + entry,
                )
            }
            passed(
                'v' +
                    version +
                    ' restore excludes legacy runtime files and regenerates Caddy state from DB',
            )
        }
        const legacyV2 = await makeLegacyFixture(2)
        await restoreLegacyFixture(legacyV2, legacyComposes[0]!, legacyProjects[0]!, 2)
        await command([...legacyComposes[0]!, 'down', '--volumes', '--remove-orphans'], 180_000)
        const legacyV1 = await makeLegacyFixture(1)
        await restoreLegacyFixture(legacyV1, legacyComposes[1]!, legacyProjects[1]!, 1)
    } finally {
        backend?.stop(true)
        await commandFails([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await commandFails([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000)
        for (const legacyCompose of legacyComposes)
            await commandFails([...legacyCompose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await commandFails(['docker', 'image', 'rm', '--force', imageTag], 180_000)
        await rm(temporaryRoot, { force: true, recursive: true })
    }
}

try {
    await runSmoke()
    console.log('Appliance Compose smoke passed: ' + assertions + ' assertions')
} catch (error) {
    // Assertion messages can contain generated secret values. Keep the type and source location.
    console.error(
        'Appliance Compose smoke failed: ' +
            (error instanceof Error ? error.name : 'unknown error'),
    )
    const location =
        error instanceof Error
            ? error.stack?.match(/appliance-compose-smoke\.ts:(\d+):(\d+)/u)
            : undefined
    if (location)
        console.error('at scripts/appliance-compose-smoke.ts:' + location[1] + ':' + location[2])
    process.exitCode = 1
}
