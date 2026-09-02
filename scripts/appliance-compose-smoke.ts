// oxlint-disable no-await-in-loop -- Readiness probes deliberately poll in a bounded sequence.

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
        cmd: argumentsList,
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
        cmd: argumentsList,
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

function digest(value: string): string {
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
    const temporaryCompose = rootCompose
        .replace('ghcr.io/rentnerkev/rentnerproxy:latest', imageTag)
        .replace("- '80:8080'", `- '127.0.0.1:${httpPort}:8080'`)
        .replace("- '81:3000'", `- '127.0.0.1:${managementPort}:3000'`)
        .replace("- '443:8443'", `- '127.0.0.1:${httpsPort}:8443'`)
        .replace('- rentnerproxy:/var/lib/rentnerproxy', `- ${volumeName}:/var/lib/rentnerproxy`)
        .replace('\nvolumes:\n    rentnerproxy:\n', `\nvolumes:\n    ${volumeName}:\n`)
    assert.notEqual(
        temporaryCompose,
        rootCompose,
        'temporary appliance Compose was not transformed',
    )
    await writeFile(temporaryComposeFile, temporaryCompose, 'utf8')
    const compose = composeCommand(envFile, temporaryComposeFile)
    const restoreProject = project + '-restore'
    const restoreCompose = composeCommand(envFile, temporaryComposeFile, restoreProject)
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
                    ports?: Array<{ published: string; target: number }>
                    volumes?: Array<{ source?: string; target: string }>
                }
            >
            volumes?: Record<string, unknown>
        }
        assert.deepEqual(Object.keys(rendered.services), ['rentnerproxy'])
        const service = rendered.services.rentnerproxy
        assert.ok(service)
        assert.deepEqual(Object.keys(service.environment ?? {}).toSorted(), smtpNames)
        assert.deepEqual(
            (service.ports ?? []).map(({ published, target }) => ({ published, target })),
            [
                { published: String(httpPort), target: 8080 },
                { published: String(managementPort), target: 3000 },
                { published: String(httpsPort), target: 8443 },
            ],
        )
        assert.deepEqual(Object.keys(rendered.volumes ?? {}), [volumeName])
        assert.deepEqual(
            (service.volumes ?? []).map(({ source, target }) => ({ source, target })),
            [{ source: volumeName, target: '/var/lib/rentnerproxy' }],
        )
        passed('appliance Compose renders as one service with only SMTP env, ports, and one volume')

        await commandFails([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await command([...compose, 'up', '--detach'], 900_000)
        const id = await containerId(compose)
        await waitForHealthy(id)
        passed('empty appliance volume builds and starts healthy')

        const setup = await httpStatus('http://127.0.0.1:' + managementPort + '/setup')
        assert.equal(setup.status, 200)
        assert.match(setup.body, /setup|RentnerProxy/iu)
        const live = await httpStatus('http://127.0.0.1:' + managementPort + '/health/live')
        assert.equal(live.status, 200)
        assert.deepEqual(JSON.parse(live.body), { status: 'ok' })
        const ready = await httpStatus('http://127.0.0.1:' + managementPort + '/health/ready')
        assert.equal(ready.status, 200)
        assert.deepEqual(JSON.parse(ready.body), { status: 'ready' })
        const proxy = await httpStatus('http://127.0.0.1:' + httpPort + '/')
        assert.ok(proxy.status >= 200 && proxy.status < 500)
        passed('setup, liveness, readiness, and proxy HTTP endpoints respond')

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
        assert.equal(backupMetadata.version, 2)
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
    } finally {
        await commandFails([...compose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await commandFails([...restoreCompose, 'down', '--volumes', '--remove-orphans'], 180_000)
        await commandFails(['docker', 'image', 'rm', '--force', imageTag], 180_000)
        await rm(temporaryRoot, { force: true, recursive: true })
    }
}

try {
    await runSmoke()
    console.log('Appliance Compose smoke passed: ' + assertions + ' assertions')
} catch (error) {
    const message = error instanceof Error ? error.message : 'unknown smoke error'
    console.error('Appliance Compose smoke failed: ' + message)
    process.exitCode = 1
}
