import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { uuidV7 } from './alpha4-persistence/crypto'
import { psql, sqlJson, sqlQuote } from './alpha4-persistence/storage'
import type { Command } from './alpha1-upgrade-fixture'
import {
    forwardAuthInputSchema,
    type ForwardAuthConfiguration,
} from '../web/src/shared/Helpers/forwardAuth'

interface ImportResultItem {
    readonly kind: 'proxy-host'
    readonly sourceId: number
    readonly label: string
    readonly domains: readonly string[]
    readonly status: 'manual'
    readonly reasons: readonly string[]
    readonly outcome: 'skipped'
}

interface ImportResult {
    readonly status: 'completed'
    readonly items: readonly ImportResultItem[]
    readonly imported: 0
    readonly skipped: 1
    readonly failed: 0
}

export interface BetaBackupStateFixture {
    readonly forwardAuthPolicyId: string
    readonly importerRunId: string
    readonly sourceFingerprint: string
    readonly sourceSchema: 'npm-2.16-schema'
    readonly expectedForwardAuthJson: string
    readonly expectedImporterResultJson: string
}

export async function seedBetaBackupState(input: {
    readonly command: Command
    readonly containerId: string
    readonly runId: string
}): Promise<BetaBackupStateFixture> {
    const runId = input.runId.toLowerCase().replace(/[^a-z0-9-]/gu, '') || 'fixture'
    const domain = 'manual-' + runId + '.compat.invalid'
    const forwardAuth: ForwardAuthConfiguration = forwardAuthInputSchema.parse({
        provider: 'generic',
        endpoint: 'https://auth-' + runId + '.compat.invalid/check',
        timeoutSeconds: 7,
        gatewayPathPrefix: '/auth-gateway/',
        requestHeaders: ['Cookie'],
        responseHeaders: ['X-Authenticated-User', 'X-Authenticated-Email'],
    })
    const importerResult: ImportResult = {
        status: 'completed',
        items: [
            {
                kind: 'proxy-host',
                sourceId: 41,
                label: domain,
                domains: [domain],
                status: 'manual',
                reasons: ['advanced_config_manual'],
                outcome: 'skipped',
            },
        ],
        imported: 0,
        skipped: 1,
        failed: 0,
    }
    const forwardAuthPolicyId = uuidV7()
    const importerRunId = uuidV7()
    const sourceFingerprint = createHash('sha256')
        .update('beta-backup-state:' + input.runId)
        .digest('hex')
    const sourceSchema = 'npm-2.16-schema' as const

    await psql(
        input.command,
        input.containerId,
        `begin;
insert into rentnerproxy.access_policies
    (id, name, description, mode, combination, ip_rules, forward_auth)
values
    (${sqlQuote(forwardAuthPolicyId)}, ${sqlQuote('Backup Forward Auth ' + runId)}, '', 'authenticated', null, null, ${sqlJson(forwardAuth)});
insert into rentnerproxy.npm_import_runs
    (id, actor_user_id, source_fingerprint, source_schema, result, runtime_status)
values
    (${sqlQuote(importerRunId)}, null, ${sqlQuote(sourceFingerprint)}, ${sqlQuote(sourceSchema)}, ${sqlJson(importerResult)}, 'applied');
commit;`,
    )

    return {
        forwardAuthPolicyId,
        importerRunId,
        sourceFingerprint,
        sourceSchema,
        expectedForwardAuthJson: JSON.stringify(forwardAuth),
        expectedImporterResultJson: JSON.stringify(importerResult),
    }
}

export async function assertBetaBackupState(input: {
    readonly command: Command
    readonly containerId: string
    readonly fixture: BetaBackupStateFixture
}): Promise<void> {
    const fixture = input.fixture
    const forwardAuth = JSON.parse(fixture.expectedForwardAuthJson) as ForwardAuthConfiguration
    const importerResult = JSON.parse(fixture.expectedImporterResultJson) as ImportResult
    const output = await psql(
        input.command,
        input.containerId,
        `select row_to_json(t) from (select
            (select count(*) from rentnerproxy.access_policies p
                where p.id = ${sqlQuote(fixture.forwardAuthPolicyId)}
                    and p.mode = 'authenticated'
                    and p.combination is null
                    and p.ip_rules is null
                    and p.forward_auth = ${sqlJson(forwardAuth)}
                    and not exists (
                        select 1 from rentnerproxy.proxy_hosts h
                        where h.access_policy_id = p.id
                    )) as forward_auth_policy,
            (select count(*) from rentnerproxy.npm_import_runs r
                where r.id = ${sqlQuote(fixture.importerRunId)}
                    and r.actor_user_id is null
                    and r.source_fingerprint = ${sqlQuote(fixture.sourceFingerprint)}
                    and r.source_schema = ${sqlQuote(fixture.sourceSchema)}
                    and r.result = ${sqlJson(importerResult)}
                    and r.runtime_status = 'applied') as importer_run
        ) t`,
    )
    const state = JSON.parse(output) as Record<'forward_auth_policy' | 'importer_run', number>
    assert.equal(Number(state.forward_auth_policy), 1)
    assert.equal(Number(state.importer_run), 1)
}
