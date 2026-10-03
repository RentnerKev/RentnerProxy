import { inventorySchema } from './fixture.validation.ts'
import type { Inventory, ExpectedHost } from './Types/fixture.types.ts'
// oxlint-disable no-await-in-loop -- Bounded batches and dependent preparation serialize intentionally.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, readFile, rm, writeFile } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { runFixture } from '../runtime-reliability/fixture.ts'
import type { FixtureContext } from '../runtime-reliability/Types/fixture.types.ts'
import { executeBetaFixture } from '../runtime-reliability/fixture-beta.ts'
import { drainConcurrent, runBoundedTasks } from './control.ts'
import type { UpdateProxyHostInput } from '../../web/src/features/Admin/ProxyHostManagement/Types/validation.types.ts'
import type { ProxyRuntimeSnapshot } from '../../web/src/server/ProxyRuntime/Types/proxy-runtime.types.ts'

function inventoryPath(context: FixtureContext) {
    return '/tmp/rentnerproxy-scale-' + context.command.runId + '.json'
}
async function save(context: FixtureContext, inventory: Inventory) {
    await writeFile(inventoryPath(context), JSON.stringify(inventory), { mode: 0o600 })
    await chmod(inventoryPath(context), 0o600)
}
async function load(context: FixtureContext): Promise<Inventory> {
    const inventory = inventorySchema.parse(
        JSON.parse(await readFile(inventoryPath(context), 'utf8')),
    )
    assert.equal(inventory.runId, context.command.runId, 'scale inventory owner')
    assert.equal(inventory.domain, context.domain, 'scale inventory domain')
    return inventory
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
    const result = [...values]
    let state = seed >>> 0
    for (let index = result.length - 1; index > 0; index -= 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const target = state % (index + 1)
        const previous = result[index]!
        result[index] = result[target]!
        result[target] = previous
    }
    return result
}
function hostInput(host: ExpectedHost): UpdateProxyHostInput {
    return {
        proxyHostId: host.id,
        domains: host.domains,
        enabled: host.enabled,
        forwardScheme: host.forwardScheme,
        forwardHost: host.forwardHost,
        forwardPort: host.forwardPort,
        certificateId: host.certificateId,
        forceHttps: host.forceHttps,
        verifyUpstreamTls: host.verifyUpstreamTls,
        upstreamTlsServerName: host.upstreamTlsServerName,
        trustedCaId: host.trustedCaId,
        accessPolicyId: host.accessPolicyId,
    }
}
function structural(snapshot: ProxyRuntimeSnapshot) {
    const ids = [...snapshot.proxyHosts, ...snapshot.redirectHosts].map((host) => host.id)
    assert.equal(new Set(ids).size, ids.length, 'unique runtime IDs')
    const domains = [...snapshot.proxyHosts, ...snapshot.redirectHosts].flatMap(
        (host) => host.domains,
    )
    assert.equal(new Set(domains).size, domains.length, 'unique runtime domains')
    const cas = new Set(snapshot.trustedCas.map((ca) => ca.id))
    for (const host of snapshot.proxyHosts) {
        assert.ok(host.domains.length > 0, 'runtime domains complete')
        if (host.upstreamTls?.trustedCaId)
            assert.ok(cas.has(host.upstreamTls.trustedCaId), 'runtime CA exists')
        if (host.accessPolicy) assert.ok(host.accessPolicy.id, 'runtime policy exists')
    }
}
async function managementReads(context: FixtureContext) {
    const ca = await import('../../web/src/server/Admin/TrustedCaManagement/trusted-cas.service.ts')
    const [hosts, policies, cas, snapshot] = await drainConcurrent([
        context.authorized(context.hosts.getProxyHostsService),
        context.authorized(context.policies.getAccessPoliciesService),
        context.authorized(ca.getTrustedCasService),
        context.runtime.getProxyRuntimeSnapshotService(),
    ])
    assert.equal(
        new Set(hosts.map((host) => host.id)).size,
        hosts.length,
        'unique management host IDs',
    )
    assert.equal(
        new Set(policies.map((policy) => policy.id)).size,
        policies.length,
        'unique management policy IDs',
    )
    assert.equal(new Set(cas.map((entry) => entry.id)).size, cas.length, 'unique management CA IDs')
    structural(snapshot)
    return { hosts, policies, cas, snapshot }
}
async function verify(
    context: FixtureContext,
    inventory: Inventory,
    managementReadCount = 7,
    mutationCount = 0,
) {
    if (inventory.npmRuns.length) {
        const npm = await import('../../web/src/server/Admin/NpmImport/npm-import.service.ts')
        const history = await context.authorized(npm.getNpmImportRunsService)
        for (const id of inventory.npmRuns)
            assert.ok(
                history.some((run) => run.runId === id),
                'NPM history remains durable',
            )
        managementReadCount += 1
    }
    const { hosts, policies, cas, snapshot } = await managementReads(context)
    const [redirects, certificates, runtimeStatus] = await drainConcurrent([
        context.authorized(context.redirects.getRedirectHostsService),
        context.authorized(context.certificates.getCertificatesService),
        context.authorized(() => context.runtime.getProxyRuntimeStatusService()),
    ])
    const expectedIds = new Set(inventory.hosts.map((host) => host.id))
    const ownedDomain = (domain: string) => domain.endsWith('.scale-' + context.domain)
    assert.equal(
        hosts.filter((host) => host.domains.some(ownedDomain)).length,
        inventory.hosts.filter((host) => !host.deleted).length,
        'no unexpected scale hosts',
    )
    assert.equal(
        redirects.filter((host) => host.domains.some(ownedDomain)).length,
        inventory.redirects.filter((host) => !host.deleted).length,
        'no unexpected scale redirects',
    )
    assert.equal(
        hosts.filter((host) => expectedIds.has(host.id)).length,
        inventory.hosts.filter((host) => !host.deleted).length,
        'exact scale host count',
    )
    for (const expected of inventory.hosts) {
        const observed = hosts.find((host) => host.id === expected.id)
        const active = snapshot.proxyHosts.find((host) => host.id === expected.id)
        if (expected.deleted) {
            assert.equal(observed, undefined, 'deleted scale host absent')
            assert.equal(active, undefined, 'deleted scale runtime host absent')
            assert.ok(
                !hosts.some((host) =>
                    host.domains.some((domain) => expected.domains.includes(domain)),
                ),
                'deleted domains absent',
            )
            continue
        }
        assert.ok(observed, 'scale host persisted')
        for (const [key, value] of Object.entries(hostInput(expected))) {
            if (key === 'proxyHostId') continue
            assert.deepEqual(
                observed[key as keyof typeof observed],
                value,
                'scale host desired fields',
            )
        }
        assert.equal(Boolean(active), expected.enabled, 'enabled runtime membership')
        if (active) {
            assert.deepEqual(active.domains, expected.domains, 'runtime domains exact')
            assert.equal(active.forwardHost, expected.forwardHost, 'runtime upstream host exact')
            assert.equal(
                active.forwardScheme,
                expected.forwardScheme,
                'runtime upstream scheme exact',
            )
            assert.equal(active.forwardPort, expected.forwardPort, 'runtime upstream exact')
            assert.equal(
                active.certificateId ?? null,
                expected.certificateId,
                'runtime certificate exact',
            )
            assert.equal(
                active.forceHttps ?? false,
                expected.forceHttps,
                'runtime HTTPS policy exact',
            )
            if (expected.forwardScheme === 'https') {
                assert.equal(
                    active.upstreamTls?.verify,
                    expected.verifyUpstreamTls,
                    'runtime TLS verification exact',
                )
                assert.equal(
                    active.upstreamTls?.serverName,
                    expected.upstreamTlsServerName,
                    'runtime TLS server name exact',
                )
            }
            assert.equal(
                active.accessPolicy?.id ?? null,
                expected.accessPolicyId,
                'runtime policy exact',
            )
            assert.equal(
                active.upstreamTls?.trustedCaId ?? null,
                expected.trustedCaId,
                'runtime CA exact',
            )
        }
    }
    for (const expected of inventory.redirects) {
        const observed = redirects.find((host) => host.id === expected.id)
        const active = snapshot.redirectHosts.find((host) => host.id === expected.id)
        if (expected.deleted) {
            assert.equal(observed, undefined, 'deleted redirect absent')
            assert.equal(active, undefined, 'deleted runtime redirect absent')
            continue
        }
        assert.ok(observed, 'scale redirect persisted')
        for (const key of [
            'domains',
            'enabled',
            'destination',
            'statusCode',
            'preserveRequestUri',
            'certificateId',
        ] as const)
            assert.deepEqual(observed[key], expected[key], 'redirect desired fields')
        assert.equal(Boolean(active), expected.enabled, 'redirect runtime membership')
        if (active)
            assert.equal(active.destination, expected.destination, 'runtime redirect destination')
    }
    for (const expected of inventory.policies) {
        const observed = policies.find((policy) => policy.id === expected.id)
        assert.ok(observed, 'scale policy persisted')
        assert.equal(observed.name, expected.name, 'policy name preserved')
        assert.equal(observed.description, expected.description, 'policy description preserved')
        assert.equal(observed.mode, 'public', 'scale policy mode preserved')
        assert.equal(
            observed.assignedHostCount,
            inventory.hosts.filter((host) => !host.deleted && host.accessPolicyId === expected.id)
                .length,
            'policy assignment count',
        )
    }
    const certificate = certificates.find((entry) => entry.id === inventory.certificateId)
    assert.ok(certificate, 'scale certificate persisted')
    assert.equal(
        certificate.assignedHostCount,
        inventory.hosts.filter(
            (host) => !host.deleted && host.certificateId === inventory.certificateId,
        ).length,
        'certificate assignment count',
    )
    const trustedCa = cas.find((entry) => entry.id === inventory.trustedCaId)
    assert.ok(trustedCa, 'scale CA persisted')
    assert.equal(
        trustedCa.assignedHostCount,
        inventory.hosts.filter(
            (host) =>
                !host.deleted &&
                host.verifyUpstreamTls &&
                host.trustedCaId === inventory.trustedCaId,
        ).length,
        'CA assignment count',
    )
    const traffic = [
        ...inventory.hosts.flatMap((host) =>
            host.domains.map((domain) => ({
                domain,
                status: host.deleted || !host.enabled ? 404 : 200,
                backend:
                    host.backend === 'primary' ? 'a' : host.backend === 'secondary' ? 'b' : 'tls',
            })),
        ),
        ...inventory.redirects.flatMap((host) =>
            host.domains.map((domain) => ({
                domain,
                status: host.deleted || !host.enabled ? 404 : host.statusCode,
                location: host.destination,
            })),
        ),
    ]
    return {
        runId: context.command.runId,
        phase: context.command.phase,
        desiredRevision: snapshot.revision,
        runtimeStatus,
        traffic,
        inventoryFingerprint:
            'sha256:' +
            createHash('sha256')
                .update(JSON.stringify(inventorySchema.parse(inventory)))
                .digest('hex'),
        tlsHost: inventory.hosts.find(
            (host) => !host.deleted && host.enabled && host.certificateId !== null,
        )?.domains[0],
        certificateFingerprint: certificate.fingerprint,
        counts: {
            proxyHosts: inventory.hosts.filter((host) => !host.deleted).length,
            domains: [...inventory.hosts, ...inventory.redirects]
                .filter((host) => !host.deleted)
                .reduce((count, host) => count + host.domains.length, 0),
            redirectHosts: inventory.redirects.filter((host) => !host.deleted).length,
            policies: inventory.policies.length,
            certificates: 1,
            trustedCas: 1,
            managementReads: managementReadCount,
            mutations: mutationCount,
        },
    }
}
async function create(context: FixtureContext) {
    const ca = await import('../../web/src/server/Admin/TrustedCaManagement/trusted-cas.service.ts')
    let inventory: Inventory
    let preparationMutations = 0
    try {
        inventory = await load(context)
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        const [certificatePem, privateKeyPem, pem] = await Promise.all([
            readFile('/tmp/scale-leaf.pem', 'utf8'),
            readFile('/tmp/scale-leaf.key', 'utf8'),
            readFile('/tmp/reliability-ca.pem', 'utf8'),
        ])
        const certificateId = await context.authorized(() =>
            context.certificates.importCertificateService({
                name: 'Scale wildcard',
                certificatePem,
                privateKeyPem,
            }),
        )
        const trustedCaId = (
            await context.authorized(() =>
                ca.createTrustedCaService({ name: 'Scale upstream CA', pem }),
            )
        ).trustedCaId
        inventory = {
            runId: context.command.runId,
            domain: context.domain,
            certificateId,
            trustedCaId,
            hosts: [],
            redirects: [],
            policies: [],
            npmRuns: [],
        }
        await save(context, inventory)
        preparationMutations = 2
    }
    const count = context.command.hostCount
    while (inventory.policies.length < Math.max(1, Math.ceil(count / 10))) {
        const name = 'Scale ' + context.command.runId + ' ' + inventory.policies.length
        const policy = await context.authorized(() =>
            context.policies.createAccessPolicyService({
                name,
                description: '',
                mode: 'public',
                combination: null,
            }),
        )
        inventory.policies.push({ id: policy.id, name, description: '' })
        preparationMutations += 1
    }
    const indices = Array.from({ length: count }, (_, index) => index).filter(
        (index) => !inventory.hosts.some((host) => host.index === index),
    )
    await runBoundedTasks(indices, context.command.concurrency, async (index) => {
        const domains = [
            'alias-h' + index + '.scale-' + context.domain,
            'h' + index + '.scale-' + context.domain,
        ]
        const expected = {
            index,
            domains,
            enabled: true,
            forwardScheme: 'http' as const,
            forwardHost: 'host.docker.internal',
            forwardPort: context.command.upstreamPort,
            certificateId: index % 10 === 0 ? inventory.certificateId : null,
            forceHttps: false,
            verifyUpstreamTls: true,
            upstreamTlsServerName: null,
            trustedCaId: null,
            accessPolicyId: inventory.policies[Math.floor(index / 10)]!.id,
            backend: 'primary' as const,
            deleted: false,
        }
        const result = await context.authorized(() =>
            context.hosts.createProxyHostService(expected),
        )
        inventory.hosts.push({ id: result.id, ...expected })
    })
    const redirects = Array.from({ length: Math.ceil(count / 4) }, (_, index) => index).filter(
        (index) => !inventory.redirects.some((host) => host.index === index),
    )
    await runBoundedTasks(redirects, context.command.concurrency, async (index) => {
        const expected = {
            index,
            domains: ['r' + index + '.scale-' + context.domain],
            destination: 'http://h0.scale-' + context.domain + '/initial-' + index,
            statusCode: 302 as const,
            preserveRequestUri: false,
            enabled: true,
            certificateId: null,
            deleted: false,
        }
        const result = await context.authorized(() =>
            context.redirects.createRedirectHostService(expected),
        )
        inventory.redirects.push({ id: result.id, ...expected })
    })
    inventory.hosts.sort((left, right) => left.index - right.index)
    inventory.redirects.sort((left, right) => left.index - right.index)
    await save(context, inventory)
    return verify(context, inventory, 7, preparationMutations + indices.length + redirects.length)
}
async function update(context: FixtureContext, inventory: Inventory) {
    let concurrentReadBatches = 0
    const hosts = shuffled(
        inventory.hosts.filter((host) => !host.deleted),
        context.command.seed + context.command.iteration,
    )
    await runBoundedTasks(hosts, context.command.concurrency, async (host) => {
        if (host.backend !== 'trusted') {
            host.backend = (host.index + context.command.iteration) % 2 ? 'primary' : 'secondary'
            host.forwardPort =
                host.backend === 'primary'
                    ? context.command.upstreamPort
                    : context.command.secondaryPort
        }
        await runBoundedTasks(
            [
                async () => {
                    await context.authorized(() =>
                        context.hosts.updateProxyHostService(hostInput(host)),
                    )
                },
                async () => {
                    await managementReads(context)
                    concurrentReadBatches += 1
                },
            ],
            2,
            (operation) => operation(),
        )
    })
    await runBoundedTasks(hosts, context.command.concurrency, async (host) => {
        await context.authorized(() => context.hosts.disableProxyHostService(host.id))
        await context.authorized(() => context.hosts.enableProxyHostService(host.id))
        host.enabled = true
    })
    await runBoundedTasks(
        inventory.redirects.filter((host) => !host.deleted),
        context.command.concurrency,
        async (host) => {
            host.destination =
                'http://h0.scale-' +
                context.domain +
                '/round-' +
                context.command.iteration +
                '-' +
                host.index
            const { id, index: _index, deleted: _deleted, ...input } = host
            await context.authorized(() =>
                context.redirects.updateRedirectHostService({ redirectHostId: id, ...input }),
            )
        },
    )
    const policy = inventory.policies[0]!
    policy.name = 'Scale ' + context.command.runId + ' round ' + context.command.iteration
    policy.description = 'Independent patch ' + context.command.iteration
    await runBoundedTasks(
        [
            async () => {
                await context.authorized(() =>
                    context.policies.updateAccessPolicyService({
                        accessPolicyId: policy.id,
                        name: policy.name,
                    }),
                )
            },
            async () => {
                await context.authorized(() =>
                    context.policies.updateAccessPolicyService({
                        accessPolicyId: policy.id,
                        description: policy.description,
                    }),
                )
            },
        ],
        2,
        (operation) => operation(),
    )
    const sentinel = hosts.find((host) => host.backend !== 'trusted') ?? hosts[0]!
    if (sentinel.backend !== 'trusted') {
        sentinel.backend = 'primary'
        sentinel.forwardPort = context.command.upstreamPort
    }
    await context.authorized(() => context.hosts.updateProxyHostService(hostInput(sentinel)))
    await save(context, inventory)
    return verify(
        context,
        inventory,
        concurrentReadBatches * 4 + 7,
        hosts.length * 3 + inventory.redirects.filter((host) => !host.deleted).length + 3,
    )
}
async function remove(context: FixtureContext, inventory: Inventory) {
    const candidates = inventory.hosts.filter((host) => !host.deleted)
    const hosts = candidates.filter((host) => host.index % 7 === 6)
    if (hosts.length === 0 && candidates.length) hosts.push(candidates.at(-1)!)
    await runBoundedTasks(hosts, context.command.concurrency, async (host) => {
        await context.authorized(() => context.hosts.deleteProxyHostService(host.id))
        host.deleted = true
    })
    const redirects = inventory.redirects.filter((host) => !host.deleted && host.index % 5 === 4)
    await runBoundedTasks(redirects, context.command.concurrency, async (host) => {
        await context.authorized(() => context.redirects.deleteRedirectHostService(host.id))
        host.deleted = true
    })
    await save(context, inventory)
    return verify(context, inventory, 7, hosts.length + redirects.length)
}
async function trusted(context: FixtureContext, inventory: Inventory) {
    assert.ok(context.command.trustedUpstreamPort, 'trusted upstream prepared')
    const host =
        inventory.hosts.find((entry) => !entry.deleted && entry.index === 1) ?? inventory.hosts[0]!
    host.forwardScheme = 'https'
    host.forwardPort = context.command.trustedUpstreamPort
    host.upstreamTlsServerName = 'upstream.scale-' + context.domain
    host.trustedCaId = inventory.trustedCaId
    host.verifyUpstreamTls = true
    host.backend = 'trusted'
    await context.authorized(() => context.hosts.updateProxyHostService(hostInput(host)))
    await save(context, inventory)
    return verify(context, inventory, 7, 1)
}

async function npmImport(context: FixtureContext, inventory: Inventory) {
    const npm = await import('../../web/src/server/Admin/NpmImport/npm-import.service.ts')
    const { NPM_216_MIGRATIONS } =
        await import('../../web/src/server/Admin/NpmImport/npm-source.ts')
    const path = '/tmp/scale-npm-' + context.command.runId + '.sqlite'
    const count = Math.min(10, Math.max(1, Math.ceil(context.command.hostCount / 10)))
    const sqlite = new Database(path, { create: true })
    try {
        sqlite.exec(`
            create table knex_migrations (id integer primary key, name text not null);
            create table proxy_host (id integer primary key, is_deleted integer default 0, domain_names text,
                forward_scheme text, forward_host text, forward_port integer, access_list_id integer default 0,
                certificate_id integer default 0, ssl_forced integer default 0, caching_enabled integer default 0,
                block_exploits integer default 0, advanced_config text default '', allow_websocket_upgrade integer default 1,
                http2_support integer default 0, enabled integer default 1, locations text, hsts_enabled integer default 0,
                hsts_subdomains integer default 0, trust_forwarded_proto integer default 0);
            create table redirection_host (id integer primary key, is_deleted integer default 0, domain_names text,
                forward_domain_name text, forward_scheme text, forward_http_code integer, preserve_path integer,
                certificate_id integer default 0, ssl_forced integer default 0, block_exploits integer default 0,
                advanced_config text default '', http2_support integer default 0, enabled integer default 1,
                hsts_enabled integer default 0, hsts_subdomains integer default 0);
            create table access_list (id integer primary key, is_deleted integer default 0, name text,
                satisfy_any integer default 0, pass_auth integer default 1);
            create table access_list_auth (id integer primary key, access_list_id integer);
            create table access_list_client (id integer primary key, access_list_id integer, address text, directive text);
            create table certificate (id integer primary key, is_deleted integer default 0, provider text, nice_name text, domain_names text);
            create table dead_host (id integer primary key, is_deleted integer default 0, domain_names text default '[]');
            create table stream (id integer primary key, is_deleted integer default 0, incoming_port integer default 0);
        `)
        for (const migration of NPM_216_MIGRATIONS)
            sqlite.query('insert into knex_migrations (name) values (?)').run(migration)
        for (let index = 0; index < count; index += 1) {
            sqlite
                .query(
                    "insert into proxy_host (id,domain_names,forward_scheme,forward_host,forward_port) values (?,?,'http','host.docker.internal',?)",
                )
                .run(
                    index + 1,
                    JSON.stringify(['npm-h' + index + '.scale-' + context.domain]),
                    context.command.upstreamPort,
                )
            sqlite
                .query(
                    "insert into redirection_host (id,domain_names,forward_domain_name,forward_scheme,forward_http_code,preserve_path) values (?, ?, ?, 'http',302,0)",
                )
                .run(
                    index + 1,
                    JSON.stringify(['npm-r' + index + '.scale-' + context.domain]),
                    'h0.scale-' + context.domain,
                )
        }
    } finally {
        sqlite.close()
    }
    try {
        await chmod(path, 0o600)
        const fingerprint = createHash('sha256')
            .update(await readFile(path))
            .digest('hex')
        const preview = await context.authorized(() =>
            npm.previewNpmImportService(path, fingerprint),
        )
        const result = await context.authorized(() =>
            npm.applyNpmImportService(
                path,
                fingerprint,
                preview.fingerprint,
                preview.planFingerprint,
            ),
        )
        assert.equal(result.imported, count * 2, 'NPM exact imported count')
        assert.equal(result.failed, 0, 'NPM import succeeded')
        const retryPreview = await context.authorized(() =>
            npm.previewNpmImportService(path, fingerprint),
        )
        const retry = await context.authorized(() =>
            npm.applyNpmImportService(
                path,
                fingerprint,
                retryPreview.fingerprint,
                retryPreview.planFingerprint,
            ),
        )
        assert.equal(retry.imported, 0, 'NPM retry no duplicates')
        assert.equal(retry.failed, 0, 'NPM retry succeeded')
        assert.equal(retry.skipped, count * 2, 'NPM retry skipped exact source')
        inventory.npmRuns.push(result.runId, retry.runId)
        const [hosts, redirects, history] = await drainConcurrent([
            context.authorized(context.hosts.getProxyHostsService),
            context.authorized(context.redirects.getRedirectHostsService),
            context.authorized(npm.getNpmImportRunsService),
        ])
        for (const item of result.items) {
            if (item.outcome !== 'imported') continue
            assert.ok(item.targetId, 'NPM target persisted')
            if (item.kind === 'proxy-host') {
                const host = hosts.find((entry) => entry.id === item.targetId)
                assert.ok(host, 'NPM proxy target found')
                assert.deepEqual(host.domains, item.domains, 'NPM proxy domains exact')
                inventory.hosts.push({
                    id: host.id,
                    index: 1000 + item.sourceId,
                    domains: [...item.domains],
                    enabled: true,
                    forwardScheme: 'http',
                    forwardHost: 'host.docker.internal',
                    forwardPort: context.command.upstreamPort,
                    certificateId: null,
                    forceHttps: false,
                    verifyUpstreamTls: true,
                    upstreamTlsServerName: null,
                    trustedCaId: null,
                    accessPolicyId: null,
                    backend: 'primary',
                    deleted: false,
                })
            } else if (item.kind === 'redirect-host') {
                const host = redirects.find((entry) => entry.id === item.targetId)
                assert.ok(host, 'NPM redirect target found')
                assert.deepEqual(host.domains, item.domains, 'NPM redirect domains exact')
                inventory.redirects.push({
                    id: host.id,
                    index: 1000 + item.sourceId,
                    domains: [...item.domains],
                    enabled: true,
                    destination: 'http://h0.scale-' + context.domain + '/',
                    statusCode: 302,
                    preserveRequestUri: false,
                    certificateId: null,
                    deleted: false,
                })
            }
        }
        for (const id of inventory.npmRuns)
            assert.ok(
                history.some((run) => run.runId === id),
                'NPM history durable IDs',
            )
        await save(context, inventory)
        return { ...(await verify(context, inventory, 12, 2)), importRetryVerified: true }
    } finally {
        await rm(path, { force: true })
    }
}

async function executeScaleFixture(context: FixtureContext): Promise<Record<string, unknown>> {
    if (context.command.phase === 'scale-create') return create(context)
    if (!context.command.phase.startsWith('scale-')) return executeBetaFixture(context)
    const inventory = await load(context)
    switch (context.command.phase) {
        case 'scale-update':
            return update(context, inventory)
        case 'scale-read':
            return verify(context, inventory)
        case 'scale-delete':
            return remove(context, inventory)
        case 'scale-trusted-upstream':
            return trusted(context, inventory)
        case 'scale-npm-import':
            return npmImport(context, inventory)
        default:
            throw new Error('unsupported_core_phase')
    }
}
if (import.meta.main) await runFixture(executeScaleFixture)
