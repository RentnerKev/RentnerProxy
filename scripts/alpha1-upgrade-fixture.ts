import { randomBytes } from 'node:crypto'
import migrationJournal from '../web/drizzle/meta/_journal.json'

export type Command = (args: string[], timeoutMs?: number) => Promise<string>

export const ALPHA1_MIGRATION_COUNT = 13
export const ALPHA3_MIGRATION_COUNT = 17
export const CURRENT_MIGRATION_COUNT = migrationJournal.entries.length

export interface Alpha1UpgradeFixture {
    readonly runId: string
    readonly ownerUserId: string
    readonly adminUserId: string
    readonly customUserId: string
    readonly customRoleId: string
    readonly customRoleKey: string
    readonly customPermissionKeys: readonly string[]
    readonly liveProxyHostId: string
    readonly disabledTlsProxyHostId: string
    readonly redirectHostId: string
    readonly certificateId: string
    readonly trustedCaId: string
    readonly trustedCaFingerprint: string
    readonly trustedCaNotBefore: string
    readonly trustedCaNotAfter: string
    readonly passwordHash: string
    readonly certificateIssuedAt: string
    readonly certificateExpiresAt: string
    readonly certificateIssuer: string
    readonly certificateFingerprint: string
    readonly hostDomain: string
    readonly aliasDomain: string
    readonly disabledTlsDomain: string
    readonly redirectDomain: string
    readonly caPem: string
    readonly redirectDestination: string
    readonly redirectStatus: number
    readonly upstreamPort: number
    readonly globalHttpSettings: Readonly<Record<string, number>>
    readonly hostHttpSettings: Readonly<Record<string, number>>
    readonly unsupportedHostSettings: Readonly<Record<string, number>>
    readonly advancedConfig: string
    readonly managementOrigin?: string
}

const postgresPasswordFile = '/run/rentnerproxy/postgres/value'
const controllerTokenFile = '/run/rentnerproxy/controller-token/value'
const databaseName = 'rentnerproxy'
const databaseUser = 'rentnerproxy'

function shellQuote(value: string): string {
    return "'" + value.replaceAll("'", "'\"'\"'") + "'"
}

function sqlQuote(value: string): string {
    return "'" + value.replaceAll("'", "''") + "'"
}

function uuidV7(): string {
    const bytes = randomBytes(16)
    const timestamp = BigInt(Date.now())
    bytes[0] = Number((timestamp >> 40n) & 0xffn)
    bytes[1] = Number((timestamp >> 32n) & 0xffn)
    bytes[2] = Number((timestamp >> 24n) & 0xffn)
    bytes[3] = Number((timestamp >> 16n) & 0xffn)
    bytes[4] = Number((timestamp >> 8n) & 0xffn)
    bytes[5] = Number(timestamp & 0xffn)
    bytes[6] = (bytes[6]! & 0x0f) | 0x70
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = bytes.toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validateRunId(runId: string): void {
    if (!/^[a-z0-9][a-z0-9_-]{5,63}$/u.test(runId)) {
        throw new Error('Alpha 1 fixture runId must be a bounded lowercase identifier.')
    }
}

async function inContainer(
    command: Command,
    containerId: string,
    script: string,
    timeoutMs = 60_000,
): Promise<string> {
    return command(['docker', 'exec', containerId, 'sh', '-ceu', script], timeoutMs)
}

async function psql(
    command: Command,
    containerId: string,
    statement: string,
    timeoutMs = 60_000,
): Promise<string> {
    const script =
        'PGPASSWORD="$(cat ' +
        postgresPasswordFile +
        ')" gosu postgres psql --no-psqlrc --no-password --quiet --set=ON_ERROR_STOP=1 ' +
        '--tuples-only --no-align --host=127.0.0.1 --username=' +
        databaseUser +
        ' --dbname=' +
        databaseName +
        ' --command=' +
        shellQuote(statement)
    return inContainer(command, containerId, script, timeoutMs)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Controller returned invalid ${label} metadata.`)
    }
    return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${label}.`)
    return value
}

function safeJson(value: string, label: string): Record<string, unknown> {
    try {
        return requireRecord(JSON.parse(value), label)
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Controller returned invalid ${label}.`, { cause: error })
        }
        throw error
    }
}

async function generateAndImportCertificate(
    command: Command,
    containerId: string,
    directory: string,
    certificateId: string,
    hostDomain: string,
    aliasDomain: string,
): Promise<{ readonly caPem: string; readonly metadata: Record<string, unknown> }> {
    const caSubject = '/CN=RentnerProxy Alpha1 Fixture CA'
    const leafSubject = '/CN=' + hostDomain
    const extfile = directory + '/leaf.ext'
    const caPemPath = directory + '/ca.pem'
    const leafPemPath = directory + '/leaf.pem'
    const caKeyPath = directory + '/ca.key'
    const leafKeyPath = directory + '/leaf.key'
    const leafCsrPath = directory + '/leaf.csr'
    const caSerialPath = directory + '/ca.srl'
    const shell = [
        'umask 077',
        'mkdir -p ' + shellQuote(directory),
        'openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj ' +
            shellQuote(caSubject) +
            ' -keyout ' +
            shellQuote(caKeyPath) +
            ' -out ' +
            shellQuote(caPemPath) +
            ' >/dev/null 2>&1',
        'cat >' +
            shellQuote(extfile) +
            ' <<EOF\n[v3_req]\nsubjectAltName=DNS:' +
            hostDomain +
            ',DNS:' +
            aliasDomain +
            '\nextendedKeyUsage=serverAuth\nEOF',
        'openssl req -new -newkey rsa:2048 -nodes -subj ' +
            shellQuote(leafSubject) +
            ' -keyout ' +
            shellQuote(leafKeyPath) +
            ' -out ' +
            shellQuote(leafCsrPath) +
            ' >/dev/null 2>&1',
        'openssl x509 -req -days 825 -sha256 -in ' +
            shellQuote(leafCsrPath) +
            ' -CA ' +
            shellQuote(caPemPath) +
            ' -CAkey ' +
            shellQuote(caKeyPath) +
            ' -CAcreateserial -CAserial ' +
            shellQuote(caSerialPath) +
            ' -extfile ' +
            shellQuote(extfile) +
            ' -extensions v3_req' +
            ' -out ' +
            shellQuote(leafPemPath) +
            ' >/dev/null 2>&1',
    ].join('\n')
    await inContainer(command, containerId, shell, 120_000)
    const fingerprintOutput = await inContainer(
        command,
        containerId,
        'openssl x509 -in ' + shellQuote(caPemPath) + ' -noout -fingerprint -sha256',
        30_000,
    )
    const fingerprintMatch = /fingerprint=([0-9a-f:]+)/iu.exec(fingerprintOutput)
    if (!fingerprintMatch?.[1]) throw new Error('Could not read fixture CA fingerprint.')
    const caFingerprint = 'sha256:' + fingerprintMatch[1].replaceAll(':', '').toLowerCase()
    const validityOutput = await inContainer(
        command,
        containerId,
        'openssl x509 -in ' + shellQuote(caPemPath) + ' -noout -startdate -enddate',
        30_000,
    )
    const startMatch = /^notBefore=(.+)$/imu.exec(validityOutput)
    const endMatch = /^notAfter=(.+)$/imu.exec(validityOutput)
    const caNotBefore = startMatch?.[1] ? new Date(startMatch[1]).toISOString() : null
    const caNotAfter = endMatch?.[1] ? new Date(endMatch[1]).toISOString() : null
    if (!caNotBefore || !caNotAfter) throw new Error('Could not read fixture CA validity.')

    const importScript = [
        'const token=await Bun.file(' + JSON.stringify(controllerTokenFile) + ').text();',
        'const read=async p=>await Bun.file(p).text();',
        'const response=await fetch(' +
            JSON.stringify(
                'http://127.0.0.1:8081/internal/v1/certificates/' + certificateId + '/import',
            ) +
            ',{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify({certificatePem:await read(' +
            JSON.stringify(leafPemPath) +
            '),privateKeyPem:await read(' +
            JSON.stringify(leafKeyPath) +
            '),chainPem:await read(' +
            JSON.stringify(caPemPath) +
            '),requiredDomains:[' +
            JSON.stringify(hostDomain) +
            ',' +
            JSON.stringify(aliasDomain) +
            ']})});',
        'if(!response.ok){process.stderr.write(String(response.status));process.exit(1)}',
        'process.stdout.write(await response.text());',
    ].join('')
    const metadata = safeJson(
        await inContainer(command, containerId, 'bun -e ' + shellQuote(importScript), 120_000),
        'certificate import',
    )
    const caPem = await inContainer(command, containerId, 'cat ' + shellQuote(caPemPath), 30_000)
    await inContainer(
        command,
        containerId,
        'rm -f ' +
            [caKeyPath, leafKeyPath, leafCsrPath, caSerialPath, extfile, leafPemPath]
                .map(shellQuote)
                .join(' '),
        30_000,
    )
    return { caPem, metadata: { ...metadata, caFingerprint, caNotBefore, caNotAfter } }
}

export async function seedAlpha1UpgradeFixture(input: {
    readonly containerId: string
    readonly command: Command
    readonly upstreamPort: number
    readonly runId: string
    readonly managementOrigin?: string
}): Promise<Alpha1UpgradeFixture> {
    validateRunId(input.runId)
    if (
        !Number.isInteger(input.upstreamPort) ||
        input.upstreamPort < 1 ||
        input.upstreamPort > 65535
    ) {
        throw new Error('Alpha 1 fixture upstreamPort is invalid.')
    }

    const hostDomain = `alpha1-${input.runId}.test`
    const aliasDomain = `alias-alpha1-${input.runId}.test`
    const disabledTlsDomain = `tls-alpha1-${input.runId}.test`
    const redirectDomain = `redirect-alpha1-${input.runId}.test`
    const redirectDestination = `http://${hostDomain}/migrated`
    const redirectStatus = 302
    const ownerUserId = uuidV7()
    const adminUserId = uuidV7()
    const customUserId = uuidV7()
    const customRoleId = uuidV7()
    const customRoleKey = `alpha1_custom_${input.runId}`
    const liveProxyHostId = uuidV7()
    const disabledTlsProxyHostId = uuidV7()
    const redirectHostId = uuidV7()
    const certificateId = uuidV7()
    const trustedCaId = uuidV7()
    const globalHttpSettings = {
        clientMaxBodySizeBytes: 1_048_576,
        proxyConnectTimeoutSeconds: 11,
        proxyReadTimeoutSeconds: 22,
        proxySendTimeoutSeconds: 33,
        sendTimeoutSeconds: 44,
        keepaliveTimeoutSeconds: 55,
    } as const
    const hostHttpSettings = {
        clientMaxBodySizeBytes: 2_097_152,
        proxyConnectTimeoutSeconds: 12,
        proxyReadTimeoutSeconds: 23,
        proxySendTimeoutSeconds: 34,
    } as const
    const unsupportedHostSettings = {
        sendTimeoutSeconds: 45,
        keepaliveTimeoutSeconds: 56,
    } as const
    const advancedConfig = 'header_up X-RentnerProxy-Alpha1 fixture'
    const fixtureDirectory = `/tmp/rentnerproxy-alpha1-${input.runId}`
    const passwordHash = await Bun.password.hash('alpha1-upgrade-fixture-password', {
        algorithm: 'argon2id',
    })
    const certificate = await generateAndImportCertificate(
        input.command,
        input.containerId,
        fixtureDirectory,
        certificateId,
        hostDomain,
        aliasDomain,
    )
    const metadata = certificate.metadata
    const issuedAt = requireString(metadata.issuedAt, 'certificate issuedAt')
    const expiresAt = requireString(metadata.expiresAt, 'certificate expiresAt')
    const issuer = requireString(metadata.issuer, 'certificate issuer')
    const fingerprint = requireString(metadata.fingerprint, 'certificate fingerprint')
    const caFingerprint = requireString(metadata.caFingerprint, 'CA fingerprint')
    const caNotBefore = requireString(metadata.caNotBefore, 'CA notBefore')
    const caNotAfter = requireString(metadata.caNotAfter, 'CA notAfter')
    const customPermissionKeys = ['proxy_hosts.view', 'redirect_hosts.view'] as const
    if (input.managementOrigin !== undefined && input.managementOrigin.length > 2_048) {
        throw new Error('Management origin is too long.')
    }
    const managementOriginSql =
        input.managementOrigin === undefined
            ? ''
            : `,\n('management_origin_v1',${sqlQuote(JSON.stringify({ version: 1, origin: input.managementOrigin }))}::jsonb)`
    const sql = `
begin;
insert into rentnerproxy.roles (id,key,name,description,is_system)
values (${sqlQuote(customRoleId)},${sqlQuote(customRoleKey)},'Alpha 1 custom role','Preserve this custom role',false)
on conflict (key) do nothing;
insert into rentnerproxy.role_permissions (role_id,permission_id)
select r.id,p.id from rentnerproxy.roles r cross join rentnerproxy.permissions p
where r.id=${sqlQuote(customRoleId)} and p.key in (${customPermissionKeys.map(sqlQuote).join(',')})
on conflict do nothing;
insert into rentnerproxy.users (id,display_name,email,password_hash,status,profile_image_version)
values
(${sqlQuote(ownerUserId)},'Alpha 1 Fixture Owner',${sqlQuote(`owner-${input.runId}@alpha1.invalid`)},${sqlQuote(passwordHash)},'active',7),
(${sqlQuote(adminUserId)},'Alpha 1 Fixture Admin',${sqlQuote(`admin-${input.runId}@alpha1.invalid`)},${sqlQuote(passwordHash)},'active',3),
(${sqlQuote(customUserId)},'Alpha 1 Fixture Custom',${sqlQuote(`custom-${input.runId}@alpha1.invalid`)},${sqlQuote(passwordHash)},'active',1);
insert into rentnerproxy.user_settings (user_id,language,theme_mode)
values
(${sqlQuote(ownerUserId)},'de','dark'),(${sqlQuote(adminUserId)},'en','light'),(${sqlQuote(customUserId)},'fr','dark')
on conflict (user_id) do update set language=excluded.language,theme_mode=excluded.theme_mode;
insert into rentnerproxy.user_roles (user_id,role_id)
select ${sqlQuote(ownerUserId)},id from rentnerproxy.roles where key='owner'
on conflict do nothing;
insert into rentnerproxy.user_roles (user_id,role_id)
select ${sqlQuote(adminUserId)},id from rentnerproxy.roles where key='admin'
on conflict do nothing;
insert into rentnerproxy.user_roles (user_id,role_id)
values (${sqlQuote(customUserId)},${sqlQuote(customRoleId)}) on conflict do nothing;
insert into rentnerproxy.trusted_cas (id,name,pem,fingerprint_sha256,subject,issuer,not_before,not_after)
values (${sqlQuote(trustedCaId)},'Alpha 1 Fixture CA',${sqlQuote(certificate.caPem)},${sqlQuote(caFingerprint)},'CN=RentnerProxy Alpha1 Fixture CA','CN=RentnerProxy Alpha1 Fixture CA',${sqlQuote(caNotBefore)},${sqlQuote(caNotAfter)});
insert into rentnerproxy.certificates (id,name,source,environment,status,operation,issued_at,expires_at,issuer,fingerprint)
values (${sqlQuote(certificateId)},'Alpha 1 Fixture Certificate','manual',null,'valid','idle',${sqlQuote(issuedAt)},${sqlQuote(expiresAt)},${sqlQuote(issuer)},${sqlQuote(fingerprint)})
on conflict (id) do update set name=excluded.name,status=excluded.status,operation=excluded.operation,issued_at=excluded.issued_at,expires_at=excluded.expires_at,issuer=excluded.issuer,fingerprint=excluded.fingerprint;
insert into rentnerproxy.certificate_domains (certificate_id,domain)
values (${sqlQuote(certificateId)},${sqlQuote(hostDomain)}),(${sqlQuote(certificateId)},${sqlQuote(aliasDomain)}) on conflict do nothing;
insert into rentnerproxy.proxy_hosts (id,forward_scheme,forward_host,forward_port,enabled,certificate_id,force_https,verify_upstream_tls,upstream_tls_server_name,trusted_ca_id)
values
(${sqlQuote(liveProxyHostId)},'http','host.docker.internal',${input.upstreamPort},true,${sqlQuote(certificateId)},false,true,null,null),
(${sqlQuote(disabledTlsProxyHostId)},'https','host.docker.internal',${input.upstreamPort},false,null,false,true,${sqlQuote(hostDomain)},${sqlQuote(trustedCaId)});
insert into rentnerproxy.host_domains (proxy_host_id,domain)
values (${sqlQuote(liveProxyHostId)},${sqlQuote(hostDomain)}),(${sqlQuote(liveProxyHostId)},${sqlQuote(aliasDomain)}),(${sqlQuote(disabledTlsProxyHostId)},${sqlQuote(disabledTlsDomain)});
insert into rentnerproxy.redirect_hosts (id,destination,status_code,preserve_request_uri,enabled,certificate_id)
values (${sqlQuote(redirectHostId)},${sqlQuote(redirectDestination)},${redirectStatus},true,true,null);
insert into rentnerproxy.host_domains (redirect_host_id,domain)
values (${sqlQuote(redirectHostId)},${sqlQuote(redirectDomain)});
insert into rentnerproxy.proxy_host_legacy_settings (proxy_host_id,advanced_config,unsupported_settings)
values (${sqlQuote(disabledTlsProxyHostId)},${sqlQuote(advancedConfig)},${sqlQuote(JSON.stringify(unsupportedHostSettings))}::jsonb);
insert into rentnerproxy.system_settings (key,value)
values
('proxy_runtime_editor_v1',${sqlQuote(JSON.stringify({ version: 1, httpSettings: globalHttpSettings }))}::jsonb),
(${sqlQuote('proxy_runtime_host_v1:' + disabledTlsProxyHostId)},${sqlQuote(JSON.stringify({ version: 1, httpSettings: hostHttpSettings }))}::jsonb)${managementOriginSql}
on conflict (key) do update set value=excluded.value,updated_at=now();
commit;
`
    await psql(input.command, input.containerId, sql, 120_000)

    return {
        runId: input.runId,
        ownerUserId,
        adminUserId,
        customUserId,
        customRoleId,
        customRoleKey,
        customPermissionKeys,
        liveProxyHostId,
        disabledTlsProxyHostId,
        redirectHostId,
        certificateId,
        trustedCaId,
        trustedCaFingerprint: caFingerprint,
        trustedCaNotBefore: caNotBefore,
        trustedCaNotAfter: caNotAfter,
        passwordHash,
        certificateIssuedAt: issuedAt,
        certificateExpiresAt: expiresAt,
        certificateIssuer: issuer,
        certificateFingerprint: fingerprint,
        hostDomain,
        aliasDomain,
        disabledTlsDomain,
        redirectDomain,
        caPem: certificate.caPem,
        redirectDestination,
        redirectStatus,
        upstreamPort: input.upstreamPort,
        globalHttpSettings,
        hostHttpSettings,
        unsupportedHostSettings,
        advancedConfig,
        ...(input.managementOrigin === undefined
            ? {}
            : { managementOrigin: input.managementOrigin }),
    }
}

async function queryJson(
    command: Command,
    containerId: string,
    statement: string,
): Promise<Record<string, unknown>> {
    return safeJson(await psql(command, containerId, statement), 'database assertion')
}

export async function assertAlpha1UpgradeFixture(input: {
    readonly containerId: string
    readonly command: Command
    readonly fixture: Alpha1UpgradeFixture
    readonly expectAlpha2: boolean
    readonly expectedMigrationCount?: number
    readonly expectCurrentSchema?: boolean
}): Promise<void> {
    const f = input.fixture
    const managementOrigin =
        f.managementOrigin === undefined
            ? '0'
            : `(select count(*) from rentnerproxy.system_settings where key='management_origin_v1' and value=${sqlQuote(JSON.stringify({ version: 1, origin: f.managementOrigin }))}::jsonb)`
    const base = await queryJson(
        input.command,
        input.containerId,
        `select json_build_object(
            'users', (select count(*) from rentnerproxy.users where
                (id=${sqlQuote(f.ownerUserId)} and display_name='Alpha 1 Fixture Owner' and email=${sqlQuote(`owner-${f.runId}@alpha1.invalid`)} and password_hash=${sqlQuote(f.passwordHash)} and status='active' and profile_image_version=7)
                or (id=${sqlQuote(f.adminUserId)} and display_name='Alpha 1 Fixture Admin' and email=${sqlQuote(`admin-${f.runId}@alpha1.invalid`)} and password_hash=${sqlQuote(f.passwordHash)} and status='active' and profile_image_version=3)
                or (id=${sqlQuote(f.customUserId)} and display_name='Alpha 1 Fixture Custom' and email=${sqlQuote(`custom-${f.runId}@alpha1.invalid`)} and password_hash=${sqlQuote(f.passwordHash)} and status='active' and profile_image_version=1)),
            'roles', (select count(*) from rentnerproxy.roles where id=${sqlQuote(f.customRoleId)} and key=${sqlQuote(f.customRoleKey)} and name='Alpha 1 custom role' and description='Preserve this custom role' and is_system=false),
            'customPermissions', (select count(*) from rentnerproxy.role_permissions rp join rentnerproxy.permissions p on p.id=rp.permission_id where rp.role_id=${sqlQuote(f.customRoleId)}),
            'customPermissionKeys', (select count(*) from rentnerproxy.role_permissions rp join rentnerproxy.permissions p on p.id=rp.permission_id where rp.role_id=${sqlQuote(f.customRoleId)} and p.key in (${sqlQuote(f.customPermissionKeys[0]!)},${sqlQuote(f.customPermissionKeys[1]!)})),
            'ownerRole', (select count(*) from rentnerproxy.user_roles ur join rentnerproxy.roles r on r.id=ur.role_id where ur.user_id=${sqlQuote(f.ownerUserId)} and r.key='owner'),
            'adminRole', (select count(*) from rentnerproxy.user_roles ur join rentnerproxy.roles r on r.id=ur.role_id where ur.user_id=${sqlQuote(f.adminUserId)} and r.key='admin'),
            'customRoleAssignment', (select count(*) from rentnerproxy.user_roles where user_id=${sqlQuote(f.customUserId)} and role_id=${sqlQuote(f.customRoleId)}),
            'customRoleAssignments', (select count(*) from rentnerproxy.user_roles where user_id=${sqlQuote(f.customUserId)}),
            'ownerPermissions', (select count(*) from rentnerproxy.role_permissions rp join rentnerproxy.roles r on r.id=rp.role_id where r.key='owner'),
            'adminPermissions', (select count(*) from rentnerproxy.role_permissions rp join rentnerproxy.roles r on r.id=rp.role_id where r.key='admin'),
            'ownerSettings', (select count(*) from rentnerproxy.user_settings where user_id=${sqlQuote(f.ownerUserId)} and language='de' and theme_mode='dark'),
            'adminSettings', (select count(*) from rentnerproxy.user_settings where user_id=${sqlQuote(f.adminUserId)} and language='en' and theme_mode='light'),
            'customSettings', (select count(*) from rentnerproxy.user_settings where user_id=${sqlQuote(f.customUserId)} and language='fr' and theme_mode='dark'),
            'liveHost', (select count(*) from rentnerproxy.proxy_hosts where id=${sqlQuote(f.liveProxyHostId)} and forward_host='host.docker.internal' and forward_port=${f.upstreamPort} and enabled=true and forward_scheme='http' and certificate_id=${sqlQuote(f.certificateId)} and force_https=false and verify_upstream_tls=true and upstream_tls_server_name is null and trusted_ca_id is null),
            'disabledHost', (select count(*) from rentnerproxy.proxy_hosts where id=${sqlQuote(f.disabledTlsProxyHostId)} and enabled=false and forward_host='host.docker.internal' and forward_port=${f.upstreamPort} and forward_scheme='https' and certificate_id is null and force_https=false and verify_upstream_tls=true and upstream_tls_server_name=${sqlQuote(f.hostDomain)} and trusted_ca_id=${sqlQuote(f.trustedCaId)}),
            'redirect', (select count(*) from rentnerproxy.redirect_hosts where id=${sqlQuote(f.redirectHostId)} and destination=${sqlQuote(f.redirectDestination)} and status_code=${f.redirectStatus} and preserve_request_uri=true and enabled=true and certificate_id is null),
            'certificate', (select count(*) from rentnerproxy.certificates where id=${sqlQuote(f.certificateId)} and name='Alpha 1 Fixture Certificate' and source='manual' and environment is null and status='valid' and operation='idle' and issued_at=${sqlQuote(f.certificateIssuedAt)} and expires_at=${sqlQuote(f.certificateExpiresAt)} and issuer=${sqlQuote(f.certificateIssuer)} and fingerprint=${sqlQuote(f.certificateFingerprint)}),
            'trustedCa', (select count(*) from rentnerproxy.trusted_cas where id=${sqlQuote(f.trustedCaId)} and name='Alpha 1 Fixture CA' and pem=${sqlQuote(f.caPem)} and fingerprint_sha256=${sqlQuote(f.trustedCaFingerprint)} and subject='CN=RentnerProxy Alpha1 Fixture CA' and issuer='CN=RentnerProxy Alpha1 Fixture CA' and not_before=${sqlQuote(f.trustedCaNotBefore)} and not_after=${sqlQuote(f.trustedCaNotAfter)}),
            'certificateDomains', (select count(*) from rentnerproxy.certificate_domains where certificate_id=${sqlQuote(f.certificateId)} and domain in (${sqlQuote(f.hostDomain)},${sqlQuote(f.aliasDomain)})),
            'certificateDomainRows', (select count(*) from rentnerproxy.certificate_domains where certificate_id=${sqlQuote(f.certificateId)}),
            'liveDomains', (select count(*) from rentnerproxy.host_domains where proxy_host_id=${sqlQuote(f.liveProxyHostId)} and domain in (${sqlQuote(f.hostDomain)},${sqlQuote(f.aliasDomain)})),
            'liveDomainRows', (select count(*) from rentnerproxy.host_domains where proxy_host_id=${sqlQuote(f.liveProxyHostId)}),
            'disabledTlsDomains', (select count(*) from rentnerproxy.host_domains where proxy_host_id=${sqlQuote(f.disabledTlsProxyHostId)} and domain=${sqlQuote(f.disabledTlsDomain)}),
            'disabledTlsDomainRows', (select count(*) from rentnerproxy.host_domains where proxy_host_id=${sqlQuote(f.disabledTlsProxyHostId)}),
            'redirectDomains', (select count(*) from rentnerproxy.host_domains where redirect_host_id=${sqlQuote(f.redirectHostId)} and domain=${sqlQuote(f.redirectDomain)}),
            'redirectDomainRows', (select count(*) from rentnerproxy.host_domains where redirect_host_id=${sqlQuote(f.redirectHostId)}),
            'globalSettings', (select count(*) from rentnerproxy.system_settings where key='proxy_runtime_editor_v1' and value=${sqlQuote(JSON.stringify({ version: 1, httpSettings: f.globalHttpSettings }))}::jsonb),
            'hostSettings', (select count(*) from rentnerproxy.system_settings where key=${sqlQuote('proxy_runtime_host_v1:' + f.disabledTlsProxyHostId)} and value=${sqlQuote(JSON.stringify({ version: 1, httpSettings: f.hostHttpSettings }))}::jsonb),
            'legacy', (select count(*) from rentnerproxy.proxy_host_legacy_settings where proxy_host_id=${sqlQuote(f.disabledTlsProxyHostId)} and advanced_config=${sqlQuote(f.advancedConfig)} and unsupported_settings=${sqlQuote(JSON.stringify(f.unsupportedHostSettings))}::jsonb),
            'managementOrigin', ${managementOrigin},
            'migrations', (select count(*) from drizzle.__drizzle_migrations)
        ) as value`,
    )
    const number = (key: string) => Number(base[key] ?? 0)

    const expectedMigrationCount =
        input.expectedMigrationCount ??
        (input.expectAlpha2 ? CURRENT_MIGRATION_COUNT : ALPHA1_MIGRATION_COUNT)
    if (number('migrations') !== expectedMigrationCount) {
        throw new Error('Unexpected migration journal state for Alpha 1 fixture.')
    }
    if (
        number('users') !== 3 ||
        number('roles') !== 1 ||
        number('customPermissions') !== 2 ||
        number('customPermissionKeys') !== 2 ||
        number('ownerRole') !== 1 ||
        number('adminRole') !== 1 ||
        number('customRoleAssignment') !== 1 ||
        number('customRoleAssignments') !== 1 ||
        number('ownerSettings') !== 1 ||
        number('adminSettings') !== 1 ||
        number('customSettings') !== 1 ||
        number('liveHost') !== 1 ||
        number('disabledHost') !== 1 ||
        number('liveDomains') !== 2 ||
        number('disabledTlsDomains') !== 1 ||
        number('disabledTlsDomainRows') !== 1
    ) {
        throw new Error('Alpha 1 fixture identity or TLS host data was not preserved.')
    }
    if (
        number('redirect') !== 1 ||
        number('redirectDomains') !== 1 ||
        number('liveDomainRows') !== 2 ||
        number('redirectDomainRows') !== 1 ||
        number('certificate') !== 1 ||
        number('trustedCa') !== 1 ||
        number('certificateDomains') !== 2 ||
        number('certificateDomainRows') !== 2 ||
        number('legacy') !== 1
    ) {
        throw new Error('Alpha 1 fixture certificate or redirect data was not preserved.')
    }
    if (number('globalSettings') !== 1 || number('hostSettings') !== 1) {
        throw new Error('Alpha 1 fixture HTTP settings were not preserved.')
    }
    if (number('managementOrigin') !== (f.managementOrigin === undefined ? 0 : 1)) {
        throw new Error('The legacy management origin was not preserved.')
    }

    if (!input.expectAlpha2) return
    const migrated = await queryJson(
        input.command,
        input.containerId,
        `select json_build_object(
            'accessPolicies', to_regclass('rentnerproxy.access_policies') is not null,
            'certificateCandidateDefaults', (select count(*) from rentnerproxy.certificates where id=${sqlQuote(f.certificateId)} and candidate is null and dns_cleanup_pending=false),
            'basicAuth', to_regclass('rentnerproxy.access_policy_basic_auth_accounts') is not null,
            'ipRules', exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='access_policies' and column_name='ip_rules'),
            'newRolePermissions', (select count(*) from rentnerproxy.role_permissions rp join rentnerproxy.roles r on r.id=rp.role_id join rentnerproxy.permissions p on p.id=rp.permission_id where r.key in ('owner','admin') and p.key in ('access_policies.view','access_policies.create','access_policies.update','access_policies.delete','access_policies.assign','access_policies.apply','proxy-access-logs:view','audit-logs:view')),
            'legacy', (select count(*) from rentnerproxy.proxy_host_legacy_settings where proxy_host_id=${sqlQuote(f.disabledTlsProxyHostId)} and advanced_config=${sqlQuote(f.advancedConfig)} and unsupported_settings=${sqlQuote(JSON.stringify(f.unsupportedHostSettings))}::jsonb),
            'liveDomains', (select count(*) from rentnerproxy.host_domains where proxy_host_id=${sqlQuote(f.liveProxyHostId)} and domain in (${sqlQuote(f.hostDomain)},${sqlQuote(f.aliasDomain)})),
            'redirectDomains', (select count(*) from rentnerproxy.host_domains where redirect_host_id=${sqlQuote(f.redirectHostId)} and domain=${sqlQuote(f.redirectDomain)}),
            'policyColumn', exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='proxy_hosts' and column_name='access_policy_id'),
            'policyNull', (select count(*) from rentnerproxy.proxy_hosts where id in (${sqlQuote(f.liveProxyHostId)},${sqlQuote(f.disabledTlsProxyHostId)}) and access_policy_id is null),
            'durableEventCursor', to_regclass('rentnerproxy.certificate_event_cursor') is not null,
            'durableEventReceipts', to_regclass('rentnerproxy.certificate_event_receipts') is not null,
            'currentOperationColumn', exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='certificates' and column_name='current_operation'),
            'candidateColumn', exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='certificates' and column_name='candidate'),
            'nextAttemptColumn', exists(select 1 from information_schema.columns where table_schema='rentnerproxy' and table_name='certificates' and column_name='next_attempt_at')
        ) as value`,
    )
    if (
        migrated.accessPolicies !== true ||
        Number(migrated.certificateCandidateDefaults ?? 0) !== 1 ||
        migrated.basicAuth !== true ||
        migrated.ipRules !== true ||
        Number(migrated.newRolePermissions ?? 0) !== 16 ||
        migrated.policyColumn !== true ||
        ((input.expectCurrentSchema ?? true) &&
            (migrated.durableEventCursor !== true ||
                migrated.durableEventReceipts !== true ||
                migrated.currentOperationColumn !== true ||
                migrated.candidateColumn !== true ||
                migrated.nextAttemptColumn !== true)) ||
        Number(migrated.policyNull ?? 0) !== 2 ||
        Number(migrated.legacy ?? 0) !== 1 ||
        Number(migrated.liveDomains ?? 0) !== 2 ||
        Number(migrated.redirectDomains ?? 0) !== 1
    ) {
        throw new Error('Alpha 1 to Alpha 4 migration did not preserve the fixture schema/data.')
    }
}
