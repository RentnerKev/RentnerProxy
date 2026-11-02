import { expect, test } from 'bun:test'
import { canonicalPersistenceSnapshot } from '../../../../../.github/scripts/ci/fixtures/persistence/storage.ts'

test.each(
    [undefined, null, [], 'invalid', { upstream_pool: { members: ['primary'] } }].map(
        (proxyHost) => ({ proxyHost }),
    ),
)(
    'legacy local account upgrade accepts only the additive null provider field independently of host shape: %j',
    ({ proxyHost }) => {
        const legacy = { user: { id: 'local-user', status: 'active' }, proxyHost }
        const upgraded = { ...legacy, user: { ...legacy.user, oidc_provider_id: null } }
        expect(canonicalPersistenceSnapshot(upgraded)).toEqual(canonicalPersistenceSnapshot(legacy))
        expect(upgraded.user).toHaveProperty('oidc_provider_id', null)
    },
)

test('upgrade comparison normalizes both additive nullable columns without mutating either snapshot', () => {
    const legacy = {
        user: { id: 'local-user' },
        proxyHost: { forward_host: 'backend', forward_port: 4000 },
    }
    const upgraded = {
        user: { ...legacy.user, oidc_provider_id: null },
        proxyHost: { ...legacy.proxyHost, upstream_pool: null },
    }
    expect(canonicalPersistenceSnapshot(upgraded)).toEqual(legacy)
    expect(upgraded.user).toHaveProperty('oidc_provider_id', null)
    expect(upgraded.proxyHost).toHaveProperty('upstream_pool', null)
})

test('persistence comparison retains real provider ownership, changed user data and unknown columns', () => {
    const legacy = { user: { id: 'same-user', status: 'active' } }
    const managed = {
        user: { ...legacy.user, oidc_provider_id: '0194f777-4074-7000-8000-000000000003' },
    }
    expect(canonicalPersistenceSnapshot(managed)).toEqual(managed)
    expect(canonicalPersistenceSnapshot(managed)).not.toEqual(canonicalPersistenceSnapshot(legacy))
    for (const change of [
        { oidc_provider_id: '0194f777-4074-7000-8000-000000000004' },
        { status: 'disabled' },
        { unexpected_field: null },
    ]) {
        const actual = { user: { ...legacy.user, oidc_provider_id: null, ...change } }
        expect(canonicalPersistenceSnapshot(actual)).not.toEqual(
            canonicalPersistenceSnapshot(legacy),
        )
    }
    expect(
        canonicalPersistenceSnapshot({
            user: { ...managed.user, oidc_provider_id: 'changed-provider' },
        }),
    ).not.toEqual(canonicalPersistenceSnapshot(managed))
})

test('legacy single-target upgrade accepts the additive null pool column', () => {
    const legacy = {
        proxyHost: { forward_host: 'backend', forward_port: 4000 },
        job: { id: 'same-job' },
    }
    const upgraded = { ...legacy, proxyHost: { ...legacy.proxyHost, upstream_pool: null } }
    expect(canonicalPersistenceSnapshot(upgraded)).toEqual(canonicalPersistenceSnapshot(legacy))
    expect(upgraded.proxyHost).toHaveProperty('upstream_pool', null)
})

test('persistence comparison retains configured pool membership and priority changes', () => {
    const members = [
        { host: 'primary', port: 4000 },
        { host: 'secondary', port: 4001 },
    ]
    const snapshot = { proxyHost: { upstream_pool: { policy: 'first', members } } }
    expect(canonicalPersistenceSnapshot(snapshot)).toEqual(snapshot)
    expect(canonicalPersistenceSnapshot(snapshot)).not.toEqual(
        canonicalPersistenceSnapshot({
            proxyHost: { upstream_pool: { policy: 'first', members: members.toReversed() } },
        }),
    )
})

test('persistence comparison still detects changed scalar targets and unrelated data', () => {
    const expected = { proxyHost: { forward_port: 4000 }, job: { id: 'original-job' } }
    expect(
        canonicalPersistenceSnapshot({
            proxyHost: { forward_port: 4001, upstream_pool: null },
            job: expected.job,
        }),
    ).not.toEqual(expected)
    expect(
        canonicalPersistenceSnapshot({
            proxyHost: { ...expected.proxyHost, upstream_pool: null },
            job: { id: 'changed-job' },
        }),
    ).not.toEqual(expected)
})
