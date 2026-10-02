import { createHash } from 'node:crypto'
import { readFile, rm, chmod } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { executeCoreFixture, runFixture, type FixtureContext } from './fixture'

async function importNpm(context: FixtureContext) {
    const { command, authorized, domain } = context
    const npm = await import('../../web/src/server/Admin/NpmImport/npm-import.service')
    const { NPM_216_MIGRATIONS } = await import('../../web/src/server/Admin/NpmImport/npm-source')
    const path = '/tmp/reliability-npm-' + command.runId + '-' + command.iteration + '.sqlite'
    const sqlite = new Database(path, { create: true })
    try {
        sqlite.exec(`
            create table knex_migrations (id integer primary key, name text not null);
            create table proxy_host (id integer primary key, is_deleted integer default 0,
                domain_names text, forward_scheme text, forward_host text, forward_port integer,
                access_list_id integer default 0, certificate_id integer default 0,
                ssl_forced integer default 0, caching_enabled integer default 0,
                block_exploits integer default 0, advanced_config text default '',
                allow_websocket_upgrade integer default 1, http2_support integer default 0,
                enabled integer default 1, locations text, hsts_enabled integer default 0,
                hsts_subdomains integer default 0, trust_forwarded_proto integer default 0);
            create table redirection_host (id integer primary key, is_deleted integer default 0,
                domain_names text, forward_domain_name text, forward_scheme text,
                forward_http_code integer, preserve_path integer,
                certificate_id integer default 0, ssl_forced integer default 0,
                block_exploits integer default 0, advanced_config text default '',
                http2_support integer default 0, enabled integer default 1,
                hsts_enabled integer default 0, hsts_subdomains integer default 0);
            create table access_list (id integer primary key, is_deleted integer default 0,
                name text, satisfy_any integer default 0, pass_auth integer default 1);
            create table access_list_auth (id integer primary key, access_list_id integer);
            create table access_list_client (id integer primary key, access_list_id integer,
                address text, directive text);
            create table certificate (id integer primary key, is_deleted integer default 0,
                provider text, nice_name text, domain_names text);
            create table dead_host (id integer primary key, is_deleted integer default 0,
                domain_names text default '[]');
            create table stream (id integer primary key, is_deleted integer default 0,
                incoming_port integer default 0);
        `)
        const migration = sqlite.query('insert into knex_migrations (name) values (?)')
        for (const name of NPM_216_MIGRATIONS) migration.run(name)
        sqlite
            .query(`insert into proxy_host (id, domain_names, forward_scheme,
            forward_host, forward_port) values (1, ?, 'http', 'host.docker.internal', ?)`)
            .run(
                JSON.stringify(['npm-' + (command.iteration % 4) + '-' + domain]),
                command.upstreamPort,
            )
        sqlite
            .query(`insert into redirection_host (id, domain_names, forward_domain_name,
            forward_scheme, forward_http_code, preserve_path) values (2, ?, ?, 'http', 302, 1)`)
            .run(JSON.stringify(['npm-redirect-' + (command.iteration % 4) + '-' + domain]), domain)
    } finally {
        sqlite.close()
    }
    try {
        await chmod(path, 0o600)
        const fingerprint = createHash('sha256')
            .update(await readFile(path))
            .digest('hex')
        const preview = await authorized(() => npm.previewNpmImportService(path, fingerprint))
        const result = await authorized(() =>
            npm.applyNpmImportService(
                path,
                fingerprint,
                preview.fingerprint,
                preview.planFingerprint,
            ),
        )
        const retryPreview = await authorized(() => npm.previewNpmImportService(path, fingerprint))
        const retry = await authorized(() =>
            npm.applyNpmImportService(
                path,
                fingerprint,
                retryPreview.fingerprint,
                retryPreview.planFingerprint,
            ),
        )
        context.state.npmHistoryId = result.runId
        context.state.npmRetryHistoryId = retry.runId
        await context.save()
        const history = await authorized(npm.getNpmImportRunsService)
        return {
            historyId: result.runId,
            historyFound: history.some((run) => run.runId === result.runId),
            previewCounts: preview.counts,
            identicalSourceRetry: {
                historyId: retry.runId,
                imported: retry.imported,
                skipped: retry.skipped,
                failed: retry.failed,
                previewCounts: retryPreview.counts,
                historyFound: history.some((run) => run.runId === retry.runId),
            },
            imported: result.imported,
            skipped: result.skipped,
            failed: result.failed,
            mutationStatus: result.runtimeStatus,
        }
    } finally {
        await rm(path, { force: true })
    }
}

export async function executeBetaFixture(
    context: FixtureContext,
): Promise<Record<string, unknown>> {
    const { command, state, authorized, policies, runtime } = context
    const crowdsec = await import('../../web/src/server/Admin/CrowdSec/crowdsec.service')
    const closeCore = context.close
    context.close = async () => {
        try {
            await crowdsec.stopCrowdSecReconciliation()
        } finally {
            await closeCore()
        }
    }
    let detail: Record<string, unknown>
    switch (command.phase) {
        case 'crowdsec-update':
        case 'crowdsec-disable': {
            const mode = command.phase === 'crowdsec-update' ? 'managed' : 'disabled'
            const result = await authorized(() =>
                crowdsec.updateCrowdSecConfigurationService({
                    mode,
                    ...(mode === 'managed' ? { communityEnabled: false } : {}),
                }),
            )
            const configuration = await authorized(crowdsec.getCrowdSecConfigurationService)
            detail = { crowdsecMode: configuration.mode, mutationStatus: result.runtimeStatus }
            break
        }
        case 'forward-auth': {
            if (!state.policyId || !command.authPort) throw new Error('forward_auth_not_prepared')
            const result = await authorized(() =>
                policies.updateAccessPolicyService({
                    accessPolicyId: state.policyId!,
                    mode: 'authenticated',
                    combination: null,
                    ipRules: null,
                    forwardAuth: {
                        provider: 'authentik',
                        endpoint: 'http://host.docker.internal:' + command.authPort + '/auth',
                        timeoutSeconds: 2,
                        gatewayPathPrefix: '/outpost.goauthentik.io/',
                        requestHeaders: ['Authorization', 'Cookie'],
                        responseHeaders: ['Remote-User', 'Remote-Email'],
                    },
                }),
            )
            detail = {
                policyId: state.policyId,
                policyHostId: state.policyHostId,
                domain: 'policy-' + context.domain,
                mutationStatus: result.runtimeStatus,
            }
            break
        }
        case 'npm-import':
            detail = await importNpm(context)
            break
        case 'durability-read': {
            const core = await executeCoreFixture(context)
            const npm = await import('../../web/src/server/Admin/NpmImport/npm-import.service')
            const history = await authorized(npm.getNpmImportRunsService)
            detail = {
                ...core,
                importHistoryCount: history.length,
                importHistory: [state.npmHistoryId, state.npmRetryHistoryId]
                    .filter((id) => id !== undefined)
                    .map((id) => {
                        const run = history.find((entry) => entry.runId === id)
                        return {
                            id,
                            found: run !== undefined,
                            imported: run?.imported,
                            skipped: run?.skipped,
                            failed: run?.failed,
                            runtimeStatus: run?.runtimeStatus,
                        }
                    }),
            }
            break
        }
        default:
            if (command.phase === 'policy-update' && state.policyId) {
                await authorized(() =>
                    policies.updateAccessPolicyService({
                        accessPolicyId: state.policyId!,
                        forwardAuth: null,
                    }),
                )
            }
            return executeCoreFixture(context)
    }
    await crowdsec.stopCrowdSecReconciliation()
    const status = await authorized(() => runtime.getProxyRuntimeStatusService())
    const snapshot = await runtime.getProxyRuntimeSnapshotService()
    return {
        ...detail,
        runId: command.runId,
        phase: command.phase,
        desiredRevision: snapshot.revision,
        runtimeStatus: status,
    }
}

if (import.meta.main) {
    await runFixture(executeBetaFixture)
}
