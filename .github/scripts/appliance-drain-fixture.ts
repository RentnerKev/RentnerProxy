import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { DrainFixture } from './Types/appliance-drain-smoke.types.ts'

export async function controllerCall(
    context: DrainFixture,
    path: string,
    method = 'GET',
    body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
    const script = `const input=await Bun.stdin.json();
const token=(await Bun.file('/run/rentnerproxy/controller-token/value').text()).trim();
const response=await fetch('http://127.0.0.1:8081'+input.path,{method:input.method,
headers:{authorization:'Bearer '+token,'content-type':'application/json'},
body:input.body===undefined?undefined:JSON.stringify(input.body),signal:AbortSignal.timeout(55000)});
const text=await response.text();let value={};try{value=JSON.parse(text)}catch{}
process.stdout.write(JSON.stringify({status:response.status,body:value}));`
    const result = await context.command(
        [
            'exec',
            '-i',
            '--user',
            '10001:10001',
            context.container,
            'bun',
            '--no-env-file',
            '-e',
            script,
        ],
        { stdin: JSON.stringify({ path, method, ...(body === undefined ? {} : { body }) }) },
    )
    return JSON.parse(result.output)
}

export async function seedDrainFixture(context: DrainFixture): Promise<string> {
    const { command, container, domain, upstream, root } = context
    const certificateId = Bun.randomUUIDv7()
    const hostId = randomUUID()
    const certificateRoot = '/tmp/appliance-drain-certificate'
    // All certificate material stays in this newly-created test container.
    const certificateScript = `set -eu
mkdir -p "$1"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$1/ca.key" -out "$1/ca.pem" -days 1 -subj /CN=Appliance-Drain-Fixture-CA >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -keyout "$1/leaf.key" -out "$1/leaf.csr" -subj "/CN=$2" >/dev/null 2>&1
printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n' "$2" > "$1/leaf.ext"
openssl x509 -req -in "$1/leaf.csr" -CA "$1/ca.pem" -CAkey "$1/ca.key" -CAcreateserial -out "$1/leaf.pem" -days 1 -sha256 -extfile "$1/leaf.ext" >/dev/null 2>&1
chown -R 10001:10001 "$1"`
    context.step?.('fixture-certificate-generation')
    await command([
        'exec',
        container,
        'sh',
        '-c',
        certificateScript,
        'fixture',
        certificateRoot,
        domain,
    ])
    const sql = `INSERT INTO rentnerproxy.certificates (id,name,source,status,operation) VALUES ('${certificateId}','Drain fixture certificate','manual','pending','idle');
INSERT INTO rentnerproxy.proxy_hosts (id,forward_scheme,forward_host,forward_port,enabled,certificate_id,force_https,verify_upstream_tls) VALUES ('${hostId}','http','${upstream}',8088,true,'${certificateId}',false,true);
INSERT INTO rentnerproxy.host_domains (id,proxy_host_id,domain) VALUES ('${randomUUID()}','${hostId}','${domain}');
INSERT INTO rentnerproxy.system_settings (key,value) VALUES ('crowdsec_configuration_v1','{"version":1,"mode":"managed"}'::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=CURRENT_TIMESTAMP;`
    context.step?.('fixture-database-records')
    await command(
        [
            'exec',
            '-i',
            container,
            'gosu',
            'postgres',
            'psql',
            '--no-psqlrc',
            '--no-password',
            '--host=/var/run/postgresql',
            '--username=postgres',
            '--dbname=rentnerproxy',
            '--set=ON_ERROR_STOP=1',
            '--quiet',
        ],
        { stdin: sql },
    )
    const importScript = `const token=(await Bun.file('/run/rentnerproxy/controller-token/value').text()).trim();
const certificatePem=await Bun.file('${certificateRoot}/leaf.pem').text();
const privateKeyPem=await Bun.file('${certificateRoot}/leaf.key').text();
const chainPem=await Bun.file('${certificateRoot}/ca.pem').text();
const response=await fetch('http://127.0.0.1:8081/internal/v1/certificates/${certificateId}/import',{method:'POST',
headers:{authorization:'Bearer '+token,'content-type':'application/json'},
body:JSON.stringify({certificatePem,privateKeyPem,chainPem,requiredDomains:['${domain}']})});
process.stdout.write(String(response.status));if(response.status!==200)process.exit(1);`
    context.step?.('fixture-certificate-import')
    assert.equal(
        (
            await command([
                'exec',
                '--user',
                '10001:10001',
                container,
                'bun',
                '--no-env-file',
                '-e',
                importScript,
            ])
        ).output,
        '200',
    )
    const configuration = {
        version: 7,
        proxyHosts: [
            {
                id: hostId,
                domains: [domain],
                forwardScheme: 'http',
                forwardHost: upstream,
                forwardPort: 8088,
                certificateId,
            },
        ],
        redirectHosts: [],
        httpSettings: {},
        trustedCas: [],
    }
    const revision =
        'sha256:' + createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
    context.step?.('fixture-route-apply')
    assert.equal(
        (
            await controllerCall(context, '/internal/v1/proxy/config', 'PUT', {
                ...configuration,
                revision,
            })
        ).status,
        200,
    )
    context.step?.('fixture-managed-crowdsec')
    assert.equal(
        (
            await controllerCall(context, '/internal/v1/crowdsec/config', 'PUT', {
                mode: 'managed',
                communityEnabled: false,
            })
        ).status,
        200,
    )
    const caFile = join(root, 'ca.pem')
    await command(['cp', container + ':' + certificateRoot + '/ca.pem', caFile])
    return caFile
}
