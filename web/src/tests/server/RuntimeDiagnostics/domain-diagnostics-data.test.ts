import { expect, test } from 'bun:test'
import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test('context reads are ID-filtered, freshly authorized, bounded read-only transactions and never expose snapshot secrets', async () => {
    const output = await runBunScript(
        `
        import { mock } from 'bun:test'
        const id = '0198d98a-0000-7000-8000-000000000001'; const calls = []; let allowed = true; let present = true
        mock.module('./server/Auth/Core/database.server.ts', () => ({ getAuthDatabase: () => ({ transaction: async (work, options) => { calls.push(options); return work({ execute: async () => calls.push('timeout') }) } }) }))
        mock.module('./server/Auth/Access/rbac.service.ts', () => ({ requirePermissionInTransaction: async (_tx, actor, permission) => { calls.push({ actor, permission }); if (!allowed) throw new Error('denied') } }))
        const read = async (_tx, ids) => { calls.push({ ids }); return present ? [{ id, domains: ['app.example.com'], enabled: true, updatedAt: 'PRIVATE', forwardHost: 'PRIVATE-UPSTREAM' }] : [] }
        mock.module('./server/Admin/ProxyHostManagement/proxy-hosts.service.ts', () => ({ readProxyHostSummariesInTransaction: read }))
        mock.module('./server/Admin/RedirectHostManagement/redirect-hosts.service.ts', () => ({ readRedirectHostSummariesInTransaction: read }))
        mock.module('./server/ProxyRuntime/proxy-runtime-data.ts', () => ({ readProxyRuntimeSnapshot: async () => { calls.push('snapshot'); return { revision: 'sha256:' + 'a'.repeat(64), privateKeyPem: 'PRIVATE-PEM' } } }))
        const { readDomainDiagnosticsContext: readContext } = await import('./server/RuntimeDiagnostics/domain-diagnostics-data.ts')
        const input = { hostType: 'proxy', hostId: id, domain: 'app.example.com' }
        const result = await readContext('actor', input)
        const initial = [...calls]; calls.length = 0
        allowed = false; await readContext('actor', input).catch(() => undefined); const denied = [...calls]; calls.length = 0; allowed = true
        const foreign = await readContext('actor', { ...input, domain: 'foreign.example.com' }).catch(e => e.code)
        present = false; const missing = await readContext('actor', input).catch(e => e.code)
        console.log(JSON.stringify({ result, initial, denied, foreign, missing }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    const result = JSON.parse(output)
    expect(result.initial[0]).toEqual({
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
    })
    expect(result.initial.slice(1)).toEqual([
        'timeout',
        { actor: 'actor', permission: 'proxy_hosts.view' },
        { ids: ['0198d98a-0000-7000-8000-000000000001'] },
        'snapshot',
    ])
    expect(result.denied).toHaveLength(3)
    expect(result.foreign).toBe('invalid_input')
    expect(result.missing).toBe('invalid_input')
    expect(result.result.proof).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(JSON.stringify(result.result)).not.toContain('PRIVATE')
    expect(Object.keys(result.result).toSorted()).toEqual(['enabled', 'proof', 'revision'])
})
