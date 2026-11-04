// oxlint-disable no-await-in-loop -- Native lifecycle probes deliberately check durable state between phases.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { distributionCommand } from '../../distribution/process.ts'
import {
    seedPersistenceFixture,
    readPersistenceSnapshot,
    assertPersistenceFixture,
    assertPersistenceRequestDecrypts,
} from '../fixtures/persistence/state.ts'
import { psql } from '../fixtures/appliance-storage.ts'

const container = 'rentnerproxy'
async function command(args: string[], timeoutMs?: number) {
    return (
        await distributionCommand(args[0] === 'docker' ? ['podman', ...args.slice(1)] : args, {
            timeoutMs: timeoutMs ?? 120_000,
        })
    ).trim()
}
async function controller(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const script = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const response=await fetch('http://127.0.0.1:8081'+${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{authorization:'Bearer '+token,'content-type':'application/json'},${body === undefined ? '' : 'body:' + JSON.stringify(JSON.stringify(body)) + ','}});if(!response.ok)process.exit(1);process.stdout.write(await response.text())`
    return JSON.parse(
        await command([
            'podman',
            'exec',
            '--user',
            '10001:10001',
            container,
            'bun',
            '--no-env-file',
            '-e',
            script,
        ]),
    )
}

async function traffic() {
    const backend = Bun.serve({
        hostname: '0.0.0.0',
        port: 19081,
        fetch: () => new Response('distribution-native-appliance'),
    })
    try {
        const config = {
            version: 7,
            proxyHosts: [
                {
                    id: '0198d98a-0000-7000-8000-000000000001',
                    domains: ['distribution.test'],
                    forwardScheme: 'http',
                    forwardHost: 'host.containers.internal',
                    forwardPort: 19081,
                    certificateId: '0198d98a-0000-7000-8000-000000000002',
                },
            ],
            redirectHosts: [],
            httpSettings: {},
            trustedCas: [],
        }
        await controller('/internal/v1/proxy/config', 'PUT', {
            ...config,
            revision: 'sha256:' + createHash('sha256').update(JSON.stringify(config)).digest('hex'),
        })
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                assert.equal(
                    await command([
                        'curl',
                        '--fail',
                        '--silent',
                        '--max-time',
                        '3',
                        '--header',
                        'Host: distribution.test',
                        'http://127.0.0.1/',
                    ]),
                    'distribution-native-appliance',
                )
                break
            } catch (error) {
                if (attempt === 59) throw error
                await Bun.sleep(500)
            }
        }
        await command([
            'podman',
            'cp',
            container + ':/var/lib/rentnerproxy/proxy/distribution-ca.pem',
            '/root/distribution-ca.pem',
        ])
        for (const protocol of ['--http1.1', '--http2', '--http3-only']) {
            const response = await command([
                'podman',
                'run',
                '--rm',
                '--network=host',
                '--volume=/root/distribution-ca.pem:/test-ca.pem:ro',
                'localhost/rentnerproxy-distribution-http3:fixture',
                '--fail',
                '--silent',
                '--show-error',
                '--noproxy',
                '*',
                '--max-time',
                '15',
                protocol,
                '--cacert',
                '/test-ca.pem',
                '--resolve',
                'distribution.test:443:127.0.0.1',
                '--write-out',
                '\n%{http_version}',
                'https://distribution.test/',
            ])
            assert.equal(
                response,
                'distribution-native-appliance\n' +
                    (protocol === '--http1.1' ? '1.1' : protocol === '--http2' ? '2' : '3'),
            )
        }
    } finally {
        backend.stop(true)
    }
}

async function initializeTraffic() {
    await command([
        'podman',
        'exec',
        container,
        'bash',
        '-ceu',
        'directory=$(mktemp -d); openssl req -x509 -newkey rsa:2048 -nodes -keyout "$directory/ca.key" -out "$directory/ca.pem" -days 2 -subj /CN=RentnerProxy-CI; openssl req -new -newkey rsa:2048 -nodes -keyout "$directory/leaf.key" -out "$directory/leaf.csr" -subj /CN=distribution.test; printf "subjectAltName=DNS:distribution.test\\nextendedKeyUsage=serverAuth\\nbasicConstraints=critical,CA:FALSE\\n" > "$directory/leaf.ext"; openssl x509 -req -in "$directory/leaf.csr" -CA "$directory/ca.pem" -CAkey "$directory/ca.key" -CAcreateserial -out "$directory/leaf.pem" -days 2 -sha256 -extfile "$directory/leaf.ext"; install -m 0600 -o rentnerproxy -g rentnerproxy "$directory/ca.pem" /var/lib/rentnerproxy/proxy/distribution-ca.pem; chown -R 10001:10001 "$directory"; printf %s "$directory" > /tmp/distribution-cert-directory',
    ])
    const directory = await command([
        'podman',
        'exec',
        container,
        'cat',
        '/tmp/distribution-cert-directory',
    ])
    assert.match(directory, /^\/tmp\/tmp\.[A-Za-z0-9]+$/u)
    await psql(
        command,
        container,
        "INSERT INTO rentnerproxy.certificates(id,name,source,status,operation) VALUES ('0198d98a-0000-7000-8000-000000000002','Distribution fixture','manual','pending','idle')",
    )
    const script = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const d=${JSON.stringify(directory)};const response=await fetch('http://127.0.0.1:8081/internal/v1/certificates/0198d98a-0000-7000-8000-000000000002/import',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({certificatePem:await Bun.file(d+'/leaf.pem').text(),privateKeyPem:await Bun.file(d+'/leaf.key').text(),chainPem:await Bun.file(d+'/ca.pem').text(),requiredDomains:['distribution.test']})});if(!response.ok)process.exit(1);`
    await command([
        'podman',
        'exec',
        '--user',
        '10001:10001',
        container,
        'bun',
        '--no-env-file',
        '-e',
        script,
    ])
}

async function run() {
    assert.equal(process.platform, 'linux')
    assert.equal(process.getuid?.(), 0)
    await readFile('/rentnerproxy-isolated-distribution')
    const phase = process.argv[2]
    if (phase === 'seed') {
        const fixture = await seedPersistenceFixture({
            command,
            containerId: container,
            runId: 'distribution-native-fixture',
            withDnsCredential: true,
        })
        const expected = await readPersistenceSnapshot({ command, containerId: container, fixture })
        await writeFile('/root/distribution-state.json', JSON.stringify({ fixture, expected }), {
            mode: 0o600,
        })
        await psql(
            command,
            container,
            "INSERT INTO rentnerproxy.system_settings(key,value) VALUES ('distribution_probe','\"original\"'::jsonb)",
        )
        await initializeTraffic()
    } else if (phase === 'mutate') {
        await psql(
            command,
            container,
            "UPDATE rentnerproxy.system_settings SET value='\"modified\"'::jsonb WHERE key='distribution_probe'",
        )
        return
    } else if (phase !== 'verify') throw new Error('Unknown native probe phase')
    const { fixture, expected } = JSON.parse(
        await readFile('/root/distribution-state.json', 'utf8'),
    )
    await assertPersistenceFixture({ command, containerId: container, fixture, expected })
    await assertPersistenceRequestDecrypts({ command, containerId: container, fixture })
    assert.equal(
        await psql(
            command,
            container,
            "SELECT value #>> '{}' FROM rentnerproxy.system_settings WHERE key='distribution_probe'",
        ),
        'original',
    )
    assert.equal((await fetch('http://127.0.0.1:81/health/ready')).status, 200)
    assert.equal(
        await command([
            'podman',
            'exec',
            container,
            '/opt/rentnerproxy/valkey/bin/valkey-cli',
            'PING',
        ]),
        'PONG',
    )
    await controller('/internal/v1/crowdsec/config', 'PUT', {
        mode: 'managed',
        communityEnabled: false,
    })
    for (let attempt = 0; attempt < 120; attempt++) {
        const status = (await controller('/internal/v1/crowdsec/status')) as {
            managedEngine: string
            state: string
        }
        if (status.managedEngine === 'ready' && status.state === 'connected') break
        assert.ok(attempt < 119)
        await Bun.sleep(500)
    }
    const ports = JSON.parse(
        await command([
            'podman',
            'inspect',
            '--format',
            '{{json .HostConfig.PortBindings}}',
            container,
        ]),
    )
    assert.deepEqual(Object.keys(ports).toSorted(), [
        '3000/tcp',
        '8080/tcp',
        '8443/tcp',
        '8443/udp',
    ])
    assert.deepEqual(ports['3000/tcp'], [{ HostIp: '127.0.0.1', HostPort: '81' }])
    assert.equal(
        await command([
            'podman',
            'exec',
            container,
            'stat',
            '-c',
            '%u:%g:%a',
            '/var/lib/rentnerproxy/proxy',
        ]),
        '10001:10001:700',
    )
    await traffic()
}

if (import.meta.main) {
    try {
        await run()
        console.log(
            'Native appliance state, encryption, bundled services and HTTP/1.1 + HTTP/2 + HTTP/3 passed.',
        )
    } catch {
        console.error('Native distribution probe failed')
        process.exitCode = 1
    }
}
