import { expect, test } from 'bun:test'

import { runBunScript } from '@/tests/Helpers/runBunScript.ts'

test('summarizes authorized Forward Auth assignments and runtime without publishing policy details', async () => {
    const stdout = await runBunScript(
        `
        import { mock } from 'bun:test'
        const permissions = []
        let fail = false
        mock.module('./server/Admin/AccessPolicyManagement/access-policies.service.ts', () => ({
            getAccessPoliciesService: async () => {
                if (fail) throw new Error('unavailable')
                return [
                    { forwardAuth: { endpoint: 'http://private-provider' }, assignedHostCount: 3 },
                    { forwardAuth: null, assignedHostCount: 100 },
                    { forwardAuth: { endpoint: 'http://other-private-provider' }, assignedHostCount: 2 },
                ]
            },
        }))
        mock.module('./server/ProxyRuntime/proxy-runtime.service.ts', () => ({
            getProxyRuntimeStatusService: async permission => {
                permissions.push(permission)
                return { state: 'pending', activeRevision: 'internal-revision' }
            },
        }))
        const { getForwardAuthSummaryService } = await import('./server/ForwardAuth/forward-auth-summary.service.ts')
        const summary = await getForwardAuthSummaryService()
        fail = true
        let rejected = false
        try { await getForwardAuthSummaryService() } catch { rejected = true }
        console.log(JSON.stringify({ summary, permissions, rejected }))
    `,
        { cwd: new URL('../../..', import.meta.url) },
    )
    const result = JSON.parse(stdout)
    expect(result.summary).toEqual({ policyCount: 2, assignedHosts: 5, runtimeState: 'pending' })
    expect(result.permissions).toEqual(['access_policies.view', 'access_policies.view'])
    expect(result.rejected).toBe(true)
})
