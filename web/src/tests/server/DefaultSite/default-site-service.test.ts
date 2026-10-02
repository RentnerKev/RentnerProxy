import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const serviceScript = `
    import { strict as assert } from 'node:assert'
    import { mock } from 'bun:test'
    import { MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY } from './config/access-policies.config.ts'
    import { MAX_DEFAULT_SITE_HTML_BYTES } from './config/default-site.config.ts'
    import { createProxyRuntimeSnapshot, MAX_RUNTIME_PAYLOAD_BYTES } from './server/ProxyRuntime/proxy-runtime-snapshot.ts'

    let allowed = new Set()
    let transactionDenied = false
    let databaseCalls = 0
    let revision = 'sha256:' + 'a'.repeat(64)
    let settings = { mode: 'not-found' }
    let runtime = createProxyRuntimeSnapshot([])
    let status = 'applied'
    const writes = []
    const audits = []
    const failures = []
    const reconciles = []
    const events = []

    mock.module('./server/Auth/Access/authorization.service.ts', () => ({
        requirePermissionService: async (permission) => {
            if (!allowed.has(permission)) throw Object.assign(new Error('Denied'), { code: 'permission_denied' })
            return { id: '0198d98a-0000-7000-8000-000000000001' }
        },
    }))
    mock.module('./server/Auth/Access/rbac.service.ts', () => ({
        requirePermissionInTransaction: async (_transaction, _id, permission) => {
            events.push(permission)
            if (transactionDenied || !allowed.has(permission)) throw Object.assign(new Error('Revoked'), { code: 'permission_denied' })
        },
    }))
    mock.module('./server/Auth/Core/database.server.ts', () => ({
        getAuthDatabase: () => ({ transaction: async (callback) => {
            databaseCalls++
            return callback({})
        } }),
    }))
    mock.module('./server/ProxyRuntime/proxy-runtime-data.ts', () => ({
        readProxyRuntimeSnapshot: async () => {
            events.push('read')
            return { ...runtime, revision, ...(settings.mode === 'not-found' ? {} : { defaultSite: settings }) }
        },
    }))
    mock.module('./server/ProxyRuntime/proxy-runtime-settings.ts', () => ({
        lockProxyRuntimeSettings: async () => { events.push('lock') },
    }))
    mock.module('./server/DefaultSite/default-site-settings.ts', () => ({
        writeDefaultSiteSettings: async (_transaction, value) => {
            events.push('write')
            writes.push(value)
        },
    }))
    mock.module('./server/Audit/audit.service.ts', () => ({
        appendAuditEventInTransactionService: async (_transaction, event) => {
            events.push('audit')
            audits.push(event)
        },
    }))
    mock.module('./server/ProxyRuntime/audit-mutation.ts', () => ({
        recordMutationFailureBestEffort: async (event) => { failures.push(event.error.code) },
    }))
    mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({
        reconcileProxyConfigurationWithAudit: async (id) => {
            events.push('apply')
            reconciles.push(id)
            return status
        },
    }))

    const { getDefaultSiteService, saveDefaultSiteService } = await import('./server/DefaultSite/default-site.service.ts')
    const candidate = { baseRevision: revision, settings: { mode: 'custom-html', html: '<p>Private draft</p>' } }
    await assert.rejects(getDefaultSiteService(), { code: 'permission_denied' })
    await assert.rejects(saveDefaultSiteService(candidate), { code: 'permission_denied' })
    allowed = new Set(['default_site.update'])
    await assert.rejects(saveDefaultSiteService(candidate), { code: 'permission_denied' })
    assert.equal(databaseCalls, 0)

    allowed = new Set(['default_site.view', 'default_site.update', 'proxy_hosts.apply'])
    assert.deepEqual(await getDefaultSiteService(), { baseRevision: revision, settings })
    const beforeInvalid = databaseCalls
    await assert.rejects(saveDefaultSiteService({ ...candidate, settings: { mode: 'redirect', url: 'javascript:alert(1)' } }))
    assert.equal(databaseCalls, beforeInvalid)

    events.length = 0
    assert.equal(await saveDefaultSiteService(candidate), 'applied')
    assert.deepEqual(events, ['lock', 'default_site.update', 'proxy_hosts.apply', 'read', 'write', 'audit', 'apply'])
    assert.deepEqual(writes, [candidate.settings])
    assert.equal(audits[0].resource, 'proxy-runtime-settings')
    assert.equal(JSON.stringify(audits).includes(candidate.settings.html), false)

    revision = 'sha256:' + 'b'.repeat(64)
    await assert.rejects(saveDefaultSiteService(candidate), { code: 'configuration_conflict' })
    assert.equal(writes.length, 1)
    assert.equal(reconciles.length, 1)

    transactionDenied = true
    await assert.rejects(getDefaultSiteService(), { code: 'permission_denied' })
    await assert.rejects(saveDefaultSiteService({ ...candidate, baseRevision: revision }), { code: 'permission_denied' })
    assert.equal(writes.length, 1)
    assert.equal(reconciles.length, 1)
    assert.deepEqual(failures, ['configuration_conflict', 'permission_denied'])

    transactionDenied = false
    status = 'pending'
    settings = { mode: 'welcome' }
    assert.equal(await saveDefaultSiteService({ baseRevision: revision, settings }), 'pending')
    assert.deepEqual(await getDefaultSiteService(), { baseRevision: revision, settings })

    const policy = {
        id: '0198d98a-0000-7000-8000-000000000002',
        mode: 'authenticated',
        combination: null,
        basicAuth: {
            accounts: Array.from({ length: MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY }, (_, index) => ({
                username: ('synthetic-' + index.toString().padStart(4, '0')).padEnd(64, 'x'),
                passwordHash: '$argon2id$v=19$m=47104,t=1,p=1$' + 'A'.repeat(43) + '$' + 'A'.repeat(43),
            })),
        },
    }
    const host = (index) => ({
        id: '0198d98a-0000-7000-8000-' + index.toString(16).padStart(12, '0'),
        enabled: true,
        domains: Array.from({ length: 50 }, (_, domain) =>
            'h' + index.toString().padStart(4, '0') + '-d' + domain.toString().padStart(2, '0') + '.' +
            (('a'.repeat(63) + '.').repeat(3)) + 'b'.repeat(43) + '.test'),
        forwardScheme: 'http',
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
        accessPolicy: policy,
    })
    const canonicalBytes = (snapshot) => {
        const { revision: _revision, ...payload } = snapshot
        return Buffer.byteLength(JSON.stringify(payload))
    }
    const emptyBytes = canonicalBytes(createProxyRuntimeSnapshot([]))
    const hostBytes = canonicalBytes(createProxyRuntimeSnapshot([host(0)])) - emptyBytes
    const hostCount = Math.floor((MAX_RUNTIME_PAYLOAD_BYTES - 100 - emptyBytes + 1) / (hostBytes + 1))
    assert.ok(hostCount > 0 && hostCount <= 1000)
    runtime = createProxyRuntimeSnapshot(Array.from({ length: hostCount }, (_, index) => host(index)))
    revision = runtime.revision
    settings = { mode: 'not-found' }
    assert.ok(canonicalBytes(runtime) + 100 <= MAX_RUNTIME_PAYLOAD_BYTES)
    const writesBeforeOverflow = writes.length
    const auditsBeforeOverflow = audits.length
    const appliesBeforeOverflow = reconciles.length
    await assert.rejects(saveDefaultSiteService({
        baseRevision: revision,
        settings: { mode: 'custom-html', html: 'x'.repeat(MAX_DEFAULT_SITE_HTML_BYTES) },
    }), { message: 'Proxy runtime snapshot is too large.' })
    assert.equal(writes.length, writesBeforeOverflow)
    assert.equal(audits.length, auditsBeforeOverflow)
    assert.equal(reconciles.length, appliesBeforeOverflow)
    assert.deepEqual(await getDefaultSiteService(), { baseRevision: revision, settings })
    console.log('default-site-service-ok')
`

describe('default site service boundary', () => {
    test('authorizes, rejects stale or oversized candidates before writes and reports pending apply', async () => {
        const child = Bun.spawn([process.execPath, '--no-env-file', '-e', serviceScript], {
            cwd: fileURLToPath(new URL('../../..', import.meta.url)),
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(exitCode, stderr).toBe(0)
        expect(stdout.trim()).toBe('default-site-service-ok')
    })
})
