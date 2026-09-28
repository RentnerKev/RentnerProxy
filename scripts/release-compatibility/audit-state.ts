import assert from 'node:assert/strict'

import type { Alpha1UpgradeFixture, Command } from '../alpha1-upgrade-fixture'
import { uuidV7 } from '../alpha4-persistence/crypto'
import { psql, sqlJson, sqlQuote } from '../alpha4-persistence/storage'

export interface AuditFixture {
    readonly id: string
    readonly metadata: { readonly source: string }
}

export async function seedAuditFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly base: Alpha1UpgradeFixture
    readonly runId: string
}): Promise<AuditFixture> {
    const id = uuidV7()
    const metadata = { source: `release-compatibility-${input.runId}` }
    await psql(
        input.command,
        input.containerId,
        `insert into rentnerproxy.audit_events
        (id, actor_user_id, actor_kind, action, resource, target_id, result, metadata)
        values (${sqlQuote(id)},${sqlQuote(input.base.ownerUserId)},'user','create','proxy-host',${sqlQuote(input.base.liveProxyHostId)},'success',${sqlJson(metadata)})`,
    )
    return { id, metadata }
}

export async function assertAuditFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly base: Alpha1UpgradeFixture
    readonly fixture: AuditFixture
}): Promise<void> {
    const count = await psql(
        input.command,
        input.containerId,
        `select count(*) from rentnerproxy.audit_events where
        id=${sqlQuote(input.fixture.id)} and actor_user_id=${sqlQuote(input.base.ownerUserId)}
        and actor_kind='user' and action='create' and resource='proxy-host'
        and target_id=${sqlQuote(input.base.liveProxyHostId)} and result='success'
        and metadata=${sqlJson(input.fixture.metadata)}`,
    )
    assert.equal(Number(count), 1)
}
