import type { PolicyFixture } from './Types/state.types.ts'
import assert from 'node:assert/strict'

import { uuidV7 } from '../alpha4-persistence/crypto.ts'
import { psql, sqlJson, sqlQuote } from '../alpha4-persistence/storage.ts'
import type { Command } from '../Types/alpha1-upgrade-fixture.types.ts'

export async function seedPolicyFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly runId: string
    readonly upstreamPort: number
}): Promise<PolicyFixture> {
    const basicPolicyId = uuidV7()
    const ipPolicyId = uuidV7()
    const basicHostId = uuidV7()
    const ipHostId = uuidV7()
    const basicDomain = `basic-${input.runId}.test`
    const ipDomain = `ip-${input.runId}.test`
    const username = 'upgrade-fixture'
    const password = `upgrade-fixture-password-${input.runId}`
    const passwordHash = await Bun.password.hash(password, {
        algorithm: 'argon2id',
        memoryCost: 47_104,
        timeCost: 1,
    })
    const ipRules = {
        defaultAction: 'deny',
        allow: ['127.0.0.1/32'],
        deny: [],
    } as const
    await psql(
        input.command,
        input.containerId,
        `begin;
insert into rentnerproxy.access_policies (id,name,mode,ip_rules) values
(${sqlQuote(basicPolicyId)},'Upgrade Basic Auth','authenticated',null),
(${sqlQuote(ipPolicyId)},'Upgrade IP Rules','ip-restricted',${sqlJson(ipRules)});
insert into rentnerproxy.access_policy_basic_auth_accounts (policy_id,username,password_hash) values
(${sqlQuote(basicPolicyId)},${sqlQuote(username)},${sqlQuote(passwordHash)});
insert into rentnerproxy.proxy_hosts (id,forward_scheme,forward_host,forward_port,enabled,access_policy_id) values
(${sqlQuote(basicHostId)},'http','host.docker.internal',${input.upstreamPort},true,${sqlQuote(basicPolicyId)}),
(${sqlQuote(ipHostId)},'http','host.docker.internal',${input.upstreamPort},true,${sqlQuote(ipPolicyId)});
insert into rentnerproxy.host_domains (proxy_host_id,domain) values
(${sqlQuote(basicHostId)},${sqlQuote(basicDomain)}),(${sqlQuote(ipHostId)},${sqlQuote(ipDomain)});
commit;`,
    )
    return {
        basicPolicyId,
        ipPolicyId,
        basicHostId,
        ipHostId,
        basicDomain,
        ipDomain,
        username,
        password,
        passwordHash,
        ipRules,
    }
}

export async function assertPolicyFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly fixture: PolicyFixture
    readonly target: boolean
}): Promise<void> {
    const { fixture: f } = input
    const forwardAuth = input.target
        ? `,(select count(*) from rentnerproxy.access_policies where id in (${sqlQuote(f.basicPolicyId)},${sqlQuote(f.ipPolicyId)}) and forward_auth is null) as forward_auth_defaults`
        : ''
    const output = await psql(
        input.command,
        input.containerId,
        `select row_to_json(t) from (select
            (select count(*) from rentnerproxy.access_policies where
                (id=${sqlQuote(f.basicPolicyId)} and mode='authenticated' and ip_rules is null) or
                (id=${sqlQuote(f.ipPolicyId)} and mode='ip-restricted' and ip_rules=${sqlJson(f.ipRules)})) as policies,
            (select count(*) from rentnerproxy.access_policy_basic_auth_accounts where policy_id=${sqlQuote(f.basicPolicyId)} and username=${sqlQuote(f.username)} and password_hash=${sqlQuote(f.passwordHash)}) as account,
            (select count(*) from rentnerproxy.proxy_hosts where
                (id=${sqlQuote(f.basicHostId)} and access_policy_id=${sqlQuote(f.basicPolicyId)} and enabled=true) or
                (id=${sqlQuote(f.ipHostId)} and access_policy_id=${sqlQuote(f.ipPolicyId)} and enabled=true)) as hosts,
            (select count(*) from rentnerproxy.host_domains where
                (proxy_host_id=${sqlQuote(f.basicHostId)} and domain=${sqlQuote(f.basicDomain)}) or
                (proxy_host_id=${sqlQuote(f.ipHostId)} and domain=${sqlQuote(f.ipDomain)})) as domains
            ${forwardAuth}) t`,
    )
    const state = JSON.parse(output) as Record<string, number>
    assert.equal(Number(state.policies), 2)
    assert.equal(Number(state.account), 1)
    assert.equal(Number(state.hosts), 2)
    assert.equal(Number(state.domains), 2)
    if (input.target) assert.equal(Number(state.forward_auth_defaults), 2)
}

export async function assertBetaDefaults(command: Command, containerId: string): Promise<void> {
    const output = await psql(
        command,
        containerId,
        `select row_to_json(t) from (select
            (select count(*) from rentnerproxy.npm_import_runs) as importer_runs,
            (select count(*) from rentnerproxy.system_settings where key='crowdsec_configuration_v1' and value->>'mode' <> 'disabled') as active_crowdsec,
            (select count(*) from rentnerproxy.access_policies where forward_auth is not null) as forward_auth_policies
        ) t`,
    )
    const state = JSON.parse(output) as Record<string, number>
    assert.equal(Number(state.importer_runs), 0)
    assert.equal(Number(state.active_crowdsec), 0)
    assert.equal(Number(state.forward_auth_policies), 0)
    const mode = await command([
        'docker',
        'exec',
        containerId,
        'cat',
        '/run/rentnerproxy/crowdsec/desired-mode',
    ])
    assert.equal(mode, 'stopped')
}
