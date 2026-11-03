// oxlint-disable no-await-in-loop -- Mutation outcomes share one mounted hook and must settle in order.
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import renderLogicHook from '@/tests/Helpers/renderLogicHook.tsx'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY } from '@/config/access-policies.config.ts'
import { accessPolicyManagementQueryKeys } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import type { BasicAuthAccount } from '@/features/Admin/AccessPolicyManagement/Types/basic-auth.types.ts'
import type { ActionResult } from '@/features/Admin/AccessPolicyManagement/Types/access-policy-management-logic.types.ts'
import { toast } from '@rentnerkev/toasts'

const policy: AccessPolicySummary = {
    id: 'policy-1',
    name: 'Office',
    description: '',
    mode: 'combined',
    combination: 'all',
    ipRules: null,
    forwardAuth: null,
    assignedHostCount: 0,
    basicAuthAccountCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
}
const account: BasicAuthAccount = {
    id: 'account-1',
    accessPolicyId: policy.id,
    username: 'visitor',
    createdAt: new Date(),
    updatedAt: new Date(),
}
const success: ActionResult = { success: true, message: 'saved', runtimeStatus: 'applied' }
const policiesRead = mock(async () => [policy])
const runtimeRead = mock(async () => ({ available: true, state: 'synced' }))
const accountsRead = mock(async () => [account])
const createPolicy = mock(async (_input: unknown): Promise<ActionResult> => success)
const updatePolicy = mock(async (_input: unknown): Promise<ActionResult> => success)
const createAccount = mock(async (_input: unknown): Promise<ActionResult> => success)
const updateAccount = mock(async (_input: unknown): Promise<ActionResult> => success)
const apply = mock(async (): Promise<ActionResult> => success)
const remove = mock(async (_input: unknown): Promise<ActionResult> => success)
const removeAccount = mock(async (_input: unknown): Promise<ActionResult> => success)
mock.module('@/features/Admin/AccessPolicyManagement/middleware.ts', () => ({
    createAccessPolicyHandler: createPolicy,
    updateAccessPolicyHandler: updatePolicy,
    createBasicAuthAccountHandler: createAccount,
    updateBasicAuthAccountHandler: updateAccount,
    getAccessPoliciesHandler: policiesRead,
    getAccessPolicyRuntimeStatusHandler: runtimeRead,
    applyAccessPolicyConfigurationHandler: apply,
    deleteAccessPolicyHandler: remove,
    getBasicAuthAccountsHandler: accountsRead,
    deleteBasicAuthAccountHandler: removeAccount,
}))
mock.module('@/shared/Live/Hooks/useLiveInvalidation.ts', () => ({ default: () => undefined }))
const { default: useManagement } =
    await import('@/features/Admin/AccessPolicyManagement/Hooks/useAccessPolicyManagementLogic.ts')
const { default: useAccounts } =
    await import('@/features/Admin/AccessPolicyManagement/Components/AccessPolicyCredentialsModal/Hooks/useBasicAuthAccountsLogic.ts')
const { default: usePolicyForm } =
    await import('@/features/Admin/AccessPolicyManagement/Components/AccessPolicyFormModal/Hooks/useAccessPolicyFormModalLogic.ts')
const { default: useAccountForm } =
    await import('@/features/Admin/AccessPolicyManagement/Components/BasicAuthAccountFormModal/Hooks/useBasicAuthAccountFormLogic.ts')
let dispose: (() => Promise<void>) | undefined
beforeEach(() => {
    for (const action of [createPolicy, updatePolicy, createAccount, updateAccount]) {
        action.mockReset()
        action.mockResolvedValue(success)
    }
    policiesRead.mockClear()
    runtimeRead.mockClear()
    accountsRead.mockReset()
    accountsRead.mockResolvedValue([account])
    apply.mockReset()
    remove.mockReset()
    removeAccount.mockReset()
    apply.mockResolvedValue(success)
    remove.mockResolvedValue(success)
    removeAccount.mockResolvedValue(success)
    spyOn(toast, 'success').mockImplementation(() => '')
    spyOn(toast, 'error').mockImplementation(() => '')
    spyOn(toast, 'warning').mockImplementation(() => '')
})
afterEach(async () => {
    await dispose?.()
    dispose = undefined
    mock.restore()
})

test('policy management validates deletion ownership, clears successful dialogs and invalidates dependent assignments', async () => {
    const hook = await renderLogicHook(() =>
        useManagement({ permissions: Object.values(PERMISSIONS) }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isLoading)
    const invalidate = spyOn(hook.client, 'invalidateQueries')
    await hook.run((value) => value.handler.confirmDelete())
    expect(remove).not.toHaveBeenCalled()
    await hook.run((value) => value.handler.openCreate())
    expect(hook.current.state.showCreate).toBe(true)
    await hook.run((value) => value.handler.openEditor(policy))
    expect(hook.current.state.showCreate).toBe(false)
    await hook.run((value) => value.handler.setEditorOpen(true))
    expect(hook.current.state.selectedPolicy).toEqual(policy)
    await hook.run((value) => value.handler.setEditorOpen(false))
    expect(hook.current.state.selectedPolicy).toBeNull()
    await hook.run((value) => value.handler.openCredentials(policy))
    expect(hook.current.state.credentialsPolicy).toEqual(policy)
    await hook.run((value) => value.handler.setCredentialsOpen(true))
    await hook.run((value) => value.handler.setCredentialsOpen(false))
    expect(hook.current.state.credentialsPolicy).toBeNull()
    await hook.run((value) => value.handler.openDelete({ ...policy, assignedHostCount: 1 }))
    expect(hook.current.state.deleteTarget).toBeNull()
    await hook.run((value) => value.handler.openDelete(policy))
    remove.mockResolvedValueOnce({ success: false, message: 'denied' })
    await hook.run((value) => value.handler.confirmDelete())
    expect(hook.current.state.deleteTarget).toEqual(policy)
    remove.mockRejectedValueOnce(new Error('offline'))
    await hook.run((value) => value.handler.confirmDelete())
    expect(toast.error).toHaveBeenCalled()
    remove.mockResolvedValueOnce({ ...success, runtimeStatus: 'pending' })
    await hook.run((value) => value.handler.confirmDelete())
    expect(remove).toHaveBeenLastCalledWith({ data: { accessPolicyId: policy.id } })
    expect(hook.current.state.deleteTarget).toBeNull()
    expect(toast.warning).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({
        queryKey: accessPolicyManagementQueryKeys.assignable,
    })
    await hook.run((value) => value.handler.openDelete(policy))
    await hook.run((value) => value.handler.confirmDelete())
    expect(toast.success).toHaveBeenCalled()
    await hook.run((value) => value.handler.openDelete(policy))
    await hook.run((value) => value.handler.setDeleteOpen(true))
    await hook.run((value) => value.handler.setDeleteOpen(false))
    expect(hook.current.state.deleteTarget).toBeNull()
    await hook.run((value) => value.handler.handleAccountsChange())
    await hook.run((value) => {
        value.handler.handleFormSuccess()
    })
    expect(hook.current.state.showCreate).toBe(false)
    for (const outcome of ['failure', 'exception', 'success']) {
        if (outcome === 'failure')
            apply.mockResolvedValueOnce({ success: false, message: 'denied' })
        if (outcome === 'exception') apply.mockRejectedValueOnce(new Error('offline'))
        await hook.run((value) => value.handler.apply())
        await hook.waitFor((value) => !value.state.isApplying)
    }
    expect(apply).toHaveBeenCalledTimes(3)
    expect(invalidate).toHaveBeenCalledWith({
        queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
    })
})

test('without view permission the policy lists and runtime are never requested', async () => {
    const hook = await renderLogicHook(() => useManagement({ permissions: [] }))
    dispose = hook.dispose
    expect(hook.current.state.canCreate).toBe(false)
    expect(hook.current.state.canApply).toBe(false)
    expect(policiesRead).not.toHaveBeenCalled()
    expect(runtimeRead).not.toHaveBeenCalled()
})

test('account workflows bind mutation payloads to the policy and retain failed deletion for retry', async () => {
    const changed = mock(async () => undefined)
    const openChanged = mock((_open: boolean) => undefined)
    const hook = await renderLogicHook(() =>
        useAccounts({
            policy,
            canUpdate: true,
            open: true,
            onAccountsChange: changed,
            onOpenChange: openChanged,
        }),
    )
    dispose = hook.dispose
    await hook.waitFor((value) => !value.state.isLoading)
    expect(accountsRead).toHaveBeenCalledWith({ data: { accessPolicyId: policy.id } })
    await hook.run((value) => value.handler.confirmDelete())
    expect(removeAccount).not.toHaveBeenCalled()
    await hook.run((value) => value.handler.openCreate())
    expect(hook.current.state.showForm).toBe(true)
    await hook.run((value) => value.handler.openEdit(account))
    expect(hook.current.state.formAccount).toEqual(account)
    await hook.run((value) => value.handler.setFormOpen(false))
    expect(hook.current.state.formAccount).toBeNull()
    await hook.run((value) => value.handler.openDelete(account))
    removeAccount.mockResolvedValueOnce({ success: false, message: 'denied' })
    await hook.run((value) => value.handler.confirmDelete())
    expect(hook.current.state.deleteTarget).toEqual(account)
    removeAccount.mockRejectedValueOnce(new Error('offline'))
    await hook.run((value) => value.handler.confirmDelete())
    expect(hook.current.state.deleteTarget).toEqual(account)
    removeAccount.mockResolvedValueOnce({ ...success, runtimeStatus: 'pending' })
    await hook.run((value) => value.handler.confirmDelete())
    expect(removeAccount).toHaveBeenLastCalledWith({
        data: { accessPolicyId: policy.id, accountId: account.id },
    })
    expect(hook.current.state.deleteTarget).toBeNull()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalled()
    await hook.run((value) => value.handler.openDelete(account))
    await hook.run((value) => value.handler.confirmDelete())
    expect(toast.success).toHaveBeenCalled()
    await hook.run((value) => value.handler.openDelete(account))
    await hook.run((value) => value.handler.setDeleteOpen(true))
    await hook.run((value) => value.handler.setDeleteOpen(false))
    await hook.run((value) => value.handler.openCreate())
    await hook.run((value) => value.handler.handleFormSuccess())
    expect(changed).toHaveBeenCalledTimes(3)
    await hook.run(() => hook.client.invalidateQueries())
    await hook.run((value) => value.handler.handleOpenChange(true))
    await hook.run((value) => value.handler.handleOpenChange(false))
    expect(openChanged).toHaveBeenLastCalledWith(false)
    expect(hook.current.state.showForm).toBe(false)
})

test('read-only credentials cannot open mutation dialogs and full account lists cannot grow', async () => {
    const hook = await renderLogicHook(() =>
        useAccounts({
            policy,
            canUpdate: false,
            open: false,
            onAccountsChange: () => undefined,
            onOpenChange: () => undefined,
        }),
    )
    dispose = hook.dispose
    await hook.run((value) => {
        value.handler.openCreate()
        value.handler.openEdit(account)
        value.handler.openDelete(account)
    })
    expect(hook.current.state.showForm).toBe(false)
    expect(hook.current.state.deleteTarget).toBeNull()
    expect(accountsRead).not.toHaveBeenCalled()
    await hook.dispose()
    dispose = undefined
    accountsRead.mockResolvedValue(
        Array.from({ length: MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY }, (_, index) => ({
            ...account,
            id: `account-${index}`,
        })),
    )
    const full = await renderLogicHook(() =>
        useAccounts({
            policy,
            canUpdate: true,
            open: true,
            onAccountsChange: () => undefined,
            onOpenChange: () => undefined,
        }),
    )
    dispose = full.dispose
    await full.waitFor((value) => !value.state.isLoading)
    expect(full.current.state.accountLimitReached).toBe(true)
    await full.run((value) => value.handler.openCreate())
    expect(full.current.state.showForm).toBe(false)
})

test('policy form setters validate drafts and submit canonical forward-auth and IP configuration', async () => {
    const saved = mock(() => undefined)
    const hook = await renderLogicHook(
        () => usePolicyForm({ mode: 'create', onSuccess: saved }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = hook.dispose
    const submit = () =>
        hook.run(() =>
            hook.container
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
    await submit()
    expect(createPolicy).not.toHaveBeenCalled()
    expect(hook.current.state.errors.name).toBeDefined()
    await hook.run((value) => {
        value.handler.setName('  Office  ')
        value.handler.setMode('combined')
        value.handler.setAuthMethod('forwardAuth')
    })
    await hook.run((value) => {
        value.handler.setCombination('any')
        value.handler.setForwardAuthProvider('authentik')
        value.handler.setForwardAuthEndpoint('https://auth.example.com/verify')
        value.handler.setForwardAuthTimeout('10')
        value.handler.setForwardAuthGatewayPathPrefix('/outpost.goauthentik.io/')
    })
    expect(hook.current.state.values.combination).toBe('all')
    await hook.run((value) => {
        value.handler.setForwardAuthRequestHeader('Authorization', true)
        value.handler.setForwardAuthRequestHeader('Cookie', false)
        value.handler.setForwardAuthResponseHeaders('X-Auth-Request-User\nX-Auth-Request-Email')
        value.handler.setIpRules({ defaultAction: 'deny', allow: '', deny: '' })
    })
    await hook.run((value) => value.handler.setIpRuleAllow('192.0.2.0/24'))
    await hook.run((value) => value.handler.setIpRuleDeny('198.51.100.1'))
    await hook.run((value) => value.handler.setIpRuleDefaultAction('allow'))
    await submit()
    await hook.waitFor((value) => !value.state.isPending)
    expect(createPolicy).toHaveBeenLastCalledWith({
        data: {
            name: 'Office',
            mode: 'combined',
            combination: 'all',
            ipRules: { defaultAction: 'allow', allow: ['192.0.2.0/24'], deny: ['198.51.100.1/32'] },
            forwardAuth: {
                provider: 'authentik',
                endpoint: 'https://auth.example.com/verify',
                timeoutSeconds: 10,
                gatewayPathPrefix: '/outpost.goauthentik.io/',
                requestHeaders: ['Authorization'],
                responseHeaders: ['X-Auth-Request-Email', 'X-Auth-Request-User'],
            },
        },
    })
    expect(saved).toHaveBeenCalledTimes(1)
    await hook.run((value) => {
        value.handler.setMode('authenticated')
        value.handler.setAuthMethod('basicAuth')
        value.handler.setBasicAuthUsername('visitor')
        value.handler.setBasicAuthPassword('strong-test-password')
    })
    createPolicy.mockResolvedValueOnce({ ...success, runtimeStatus: 'pending' })
    await submit()
    expect(createPolicy).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
            mode: 'authenticated',
            basicAuth: { username: 'visitor', password: 'strong-test-password' },
            forwardAuth: null,
        }),
    })
    expect(toast.warning).toHaveBeenCalled()
    await hook.run((value) => {
        value.handler.setName('')
        value.handler.setMode('not-a-mode')
        value.handler.setAuthMethod('not-auth')
        value.handler.setCombination('not-combination')
        value.handler.setForwardAuthProvider('unknown')
    })
    expect(hook.current.state.values.mode).toBe('authenticated')
    expect(hook.current.state.values.authMethod).toBe('basicAuth')
    await submit()
    expect(hook.current.state.errors.name).toBeDefined()
})

test('policy editing preserves input on rejection and transport failure and clears dependent caches after success', async () => {
    const saved = mock(() => undefined)
    const hook = await renderLogicHook(
        () => usePolicyForm({ mode: 'edit', policy, onSuccess: saved }),
        (value) => <form onSubmit={value.handler.handleSubmit} />,
    )
    dispose = hook.dispose
    await hook.run((value) => {
        value.handler.setMode('public')
        value.handler.setName('Updated')
    })
    const submit = () =>
        hook.run(() =>
            hook.container
                .querySelector('form')
                ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
        )
    updatePolicy.mockResolvedValueOnce({ success: false, message: 'denied' })
    await submit()
    expect(saved).not.toHaveBeenCalled()
    updatePolicy.mockRejectedValueOnce(new Error('offline'))
    await submit()
    expect(hook.current.state.values.name).toBe('Updated')
    expect(toast.error).toHaveBeenCalled()
    const invalidate = spyOn(hook.client, 'invalidateQueries')
    await submit()
    expect(updatePolicy).toHaveBeenLastCalledWith({
        data: expect.objectContaining({
            accessPolicyId: policy.id,
            name: 'Updated',
            mode: 'public',
        }),
    })
    expect(invalidate).toHaveBeenCalledWith({
        queryKey: accessPolicyManagementQueryKeys.basicAuthAccounts(policy.id),
    })
    expect(saved).toHaveBeenCalledTimes(1)
})

test('basic auth create clears secret material only on success and edit omits unchanged passwords', async () => {
    const saved = mock(async () => undefined)
    const changed = mock((_open: boolean) => undefined)
    const hook = await renderLogicHook(() =>
        useAccountForm({
            accessPolicyId: policy.id,
            mode: 'create',
            open: true,
            onSuccess: saved,
            onOpenChange: changed,
        }),
    )
    dispose = hook.dispose
    await hook.run((value) => value.handler.submit())
    expect(createAccount).not.toHaveBeenCalled()
    await hook.run((value) => {
        value.handler.setUsername('visitor')
        value.handler.setPassword('secret-fixture-pass')
    })
    createAccount.mockResolvedValueOnce({ success: false, message: 'denied' })
    await hook.run((value) => value.handler.submit())
    expect(hook.current.state.values.password).toBe('secret-fixture-pass')
    createAccount.mockRejectedValueOnce(new Error('offline'))
    await hook.run((value) => value.handler.submit())
    expect(saved).not.toHaveBeenCalled()
    createAccount.mockResolvedValueOnce({ ...success, runtimeStatus: 'pending' })
    await hook.run((value) => value.handler.submit())
    expect(createAccount).toHaveBeenLastCalledWith({
        data: { accessPolicyId: policy.id, username: 'visitor', password: 'secret-fixture-pass' },
    })
    expect(hook.current.state.values.password).toBe('')
    await hook.run((value) => value.handler.handleOpenChange(true))
    await hook.run((value) => value.handler.handleOpenChange(false))
    expect(changed).toHaveBeenLastCalledWith(false)
    await hook.dispose()
    dispose = undefined
    const edit = await renderLogicHook(() =>
        useAccountForm({
            accessPolicyId: policy.id,
            account,
            mode: 'edit',
            open: true,
            onSuccess: saved,
            onOpenChange: changed,
        }),
    )
    dispose = edit.dispose
    await edit.run((value) => value.handler.setUsername('renamed'))
    await edit.run((value) => value.handler.submit())
    expect(updateAccount).toHaveBeenLastCalledWith({
        data: { accessPolicyId: policy.id, accountId: account.id, username: 'renamed' },
    })
    expect(toast.success).toHaveBeenCalled()
})
