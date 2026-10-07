import { psql, sqlQuote } from '../fixtures/appliance-storage.ts'
import type { ApplianceCommand } from '../fixtures/Types/appliance-storage.types.ts'
import type { AuditFixture } from './Types/audit-state.types.ts'
import assert from 'node:assert/strict'

import type { UpgradeFixture } from '../fixtures/Types/upgrade-state.types.ts'
import { sqlJson } from '../fixtures/persistence/storage.ts'

export async function seedAuditFixture(input: {
    readonly command: ApplianceCommand
    readonly containerId: string
    readonly base: UpgradeFixture
    readonly runId: string
}): Promise<AuditFixture> {
    const id = Bun.randomUUIDv7()
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
    readonly command: ApplianceCommand
    readonly containerId: string
    readonly base: UpgradeFixture
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
