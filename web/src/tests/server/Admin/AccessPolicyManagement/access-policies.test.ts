import { beforeEach, expect, mock, test } from 'bun:test'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { accessPolicies, accessPolicyBasicAuthAccounts } from '@/db/schema.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

type TestRow = Record<string, unknown>
interface TestStore {
    policies: TestRow[]
    accounts: TestRow[]
    audits: unknown[]
}
interface Selection extends PromiseLike<TestRow[]> {
    where: (condition: unknown) => Selection
    limit: (limit: number) => Selection
    for: (lock: string) => Selection
}

const policyId = '0198d98a-0000-7000-8000-000000000001'
const actorId = '0198d98a-0000-7000-8000-000000000002'
const credentials = { username: 'kevin', password: '  exact test password  ' }
let store: TestStore
let activeStore: TestStore | null = null
let denied = false
let revoked = false
let accountFailure: unknown = null
let auditFailure = false
let runtimeStatus: 'applied' | 'pending' = 'applied'
const lifecycle: string[] = []

function selection(rows: TestRow[]): Selection {
    const query: Selection = Object.assign(Promise.resolve(rows), {
        where: (_condition: unknown) => query,
        limit: (_limit: number) => query,
        for: (_lock: string) => query,
    })
    return query
}

function testTransaction(staged: TestStore): AuthTransaction {
    const transaction = {
        select: (fields?: Record<string, unknown>) => ({
            from: (table: unknown) => {
                const rows =
                    table === accessPolicies
                        ? staged.policies
                        : table === accessPolicyBasicAuthAccounts
                          ? staged.accounts
                          : []
                return selection(fields && 'count' in fields ? [{ count: rows.length }] : rows)
            },
        }),
        insert: (table: unknown) => ({
            values: (values: TestRow) => ({
                returning: async () => {
                    if (table === accessPolicyBasicAuthAccounts && accountFailure) {
                        throw accountFailure
                    }
                    const row = {
                        ...values,
                        id:
                            table === accessPolicies
                                ? policyId
                                : '0198d98a-0000-7000-8000-000000000003',
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }
                    const rows = table === accessPolicies ? staged.policies : staged.accounts
                    rows.push(row)
                    return [row]
                },
            }),
        }),
        update: () => ({
            set: (values: TestRow) => ({
                where: () => ({
                    returning: async () => {
                        staged.policies = staged.policies.map((row) => ({ ...row, ...values }))
                        return staged.policies
                    },
                }),
            }),
        }),
    }
    return transaction as unknown as AuthTransaction
}

const transactionMock = mock(
    async (callback: (transaction: AuthTransaction) => Promise<unknown>) => {
        const staged = structuredClone(store)
        activeStore = staged
        try {
            const result = await callback(testTransaction(staged))
            store = staged
            lifecycle.push('commit')
            return result
        } catch (error) {
            lifecycle.push('rollback')
            throw error
        } finally {
            activeStore = null
        }
    },
)
const permissionMock = mock(async (_permission: string) => {
    if (denied) throw new Error('permission denied')
    return { id: actorId }
})
const transactionPermissionMock = mock(
    async (_transaction: AuthTransaction, _actorId: string, _permission: string) => {
        if (revoked) throw new Error('permission revoked')
    },
)
const reconcileMock = mock(async (_actorId: string) => {
    expect(lifecycle.at(-1)).toBe('commit')
    return runtimeStatus
})

mock.module('@/server/Auth/Core/database.server.ts', () => ({
    getAuthDatabase: () => ({ transaction: transactionMock }),
}))
mock.module('@/server/Auth/Access/authorization.service.ts', () => ({
    requirePermissionService: permissionMock,
}))
mock.module('@/server/Auth/Access/rbac.service.ts', () => ({
    requirePermissionInTransaction: transactionPermissionMock,
}))
mock.module('@/server/ProxyRuntime/proxy-runtime-settings.ts', () => ({
    lockProxyRuntimeSettings: async () => undefined,
}))
mock.module('@/server/ProxyRuntime/proxy-runtime.service.ts', () => ({
    reconcileProxyConfigurationWithAudit: reconcileMock,
}))
mock.module('@/server/ProxyRuntime/audit-mutation.ts', () => ({
    recordMutationFailureBestEffort: async () => undefined,
}))
mock.module('@/server/Audit/audit.service.ts', () => ({
    appendAuditEventInTransactionService: async (
        _transaction: AuthTransaction,
        event: { resource: string },
    ) => {
        if (auditFailure && event.resource === 'basic-auth-account') {
            throw new Error('audit write failed')
        }
        activeStore?.audits.push(event)
    },
}))

const { createAccessPolicyService, updateAccessPolicyService } =
    await import('@/server/Admin/AccessPolicyManagement/access-policies.service.ts')

function seedPolicy(mode = 'public', forwardAuth: unknown = null): void {
    store.policies.push({
        id: policyId,
        name: 'Existing site',
        description: '',
        mode,
        combination: null,
        ipRules: null,
        forwardAuth,
        createdAt: new Date(),
        updatedAt: new Date(),
    })
}

beforeEach(() => {
    store = { policies: [], accounts: [], audits: [] }
    activeStore = null
    denied = false
    revoked = false
    accountFailure = null
    auditFailure = false
    runtimeStatus = 'applied'
    lifecycle.length = 0
    transactionMock.mockClear()
    permissionMock.mockClear()
    transactionPermissionMock.mockClear()
    reconcileMock.mockClear()
})

test('creates a policy and its hashed account together, then applies once after commit', async () => {
    const result = await createAccessPolicyService({
        name: 'Protected site',
        mode: 'authenticated',
        basicAuth: credentials,
    })
    expect(result.basicAuthAccountCount).toBe(1)
    expect(result.runtimeStatus).toBe('applied')
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0]?.policyId).toBe(result.accessPolicyId)
    const hash = store.accounts[0]?.passwordHash
    expect(typeof hash).toBe('string')
    expect(await Bun.password.verify(credentials.password, String(hash))).toBe(true)
    expect(await Bun.password.verify(credentials.password.trim(), String(hash))).toBe(false)
    expect(JSON.stringify({ store, result })).not.toContain(credentials.password)
    expect(JSON.stringify(result)).not.toContain('passwordHash')
    expect(store.audits).toHaveLength(2)
    expect(transactionPermissionMock).toHaveBeenCalledWith(
        expect.anything(),
        actorId,
        PERMISSIONS.ACCESS_POLICIES_CREATE,
    )
    expect(reconcileMock).toHaveBeenCalledTimes(1)
})

test('updates the policy and its first account atomically and reports pending application', async () => {
    seedPolicy()
    runtimeStatus = 'pending'
    const result = await updateAccessPolicyService({
        accessPolicyId: policyId,
        mode: 'authenticated',
        basicAuth: credentials,
    })
    expect(store.policies[0]?.mode).toBe('authenticated')
    expect(result.basicAuthAccountCount).toBe(1)
    expect(result.runtimeStatus).toBe('pending')
    expect(store.accounts[0]?.username).toBe(credentials.username)
    expect(JSON.stringify({ store, result })).not.toContain(credentials.password)
    expect(transactionPermissionMock).toHaveBeenCalledWith(
        expect.anything(),
        actorId,
        PERMISSIONS.ACCESS_POLICIES_UPDATE,
    )
    expect(reconcileMock).toHaveBeenCalledTimes(1)
})

test('rolls back the new policy and account if credential auditing fails', async () => {
    auditFailure = true
    await expect(
        createAccessPolicyService({
            name: 'Protected site',
            mode: 'authenticated',
            basicAuth: credentials,
        }),
    ).rejects.toThrow('audit write failed')
    expect(store).toEqual({ policies: [], accounts: [], audits: [] })
    expect(lifecycle).toEqual(['rollback'])
    expect(reconcileMock).not.toHaveBeenCalled()
})

test('preserves the original policy when saving its account fails', async () => {
    seedPolicy()
    accountFailure = new Error('account write failed')
    await expect(
        updateAccessPolicyService({
            accessPolicyId: policyId,
            mode: 'authenticated',
            basicAuth: credentials,
        }),
    ).rejects.toThrow('account write failed')
    expect(store.policies[0]?.mode).toBe('public')
    expect(store.accounts).toHaveLength(0)
    expect(store.audits).toHaveLength(0)
    expect(reconcileMock).not.toHaveBeenCalled()
})

test('rejects credentials if a partial update still resolves to Forward Auth', async () => {
    seedPolicy('authenticated', {
        provider: 'generic',
        endpoint: 'https://auth.example.test/authz',
        timeoutSeconds: 5,
        gatewayPathPrefix: null,
        requestHeaders: ['Cookie'],
        responseHeaders: [],
    })
    await expect(
        updateAccessPolicyService({
            accessPolicyId: policyId,
            basicAuth: credentials,
        }),
    ).rejects.toThrow('invalid_input')
    expect(store.accounts).toHaveLength(0)
    expect(reconcileMock).not.toHaveBeenCalled()
})

test('rejects unauthorized creation before opening a transaction', async () => {
    denied = true
    await expect(
        createAccessPolicyService({
            name: 'Protected site',
            mode: 'authenticated',
            basicAuth: credentials,
        }),
    ).rejects.toThrow('permission denied')
    expect(transactionMock).not.toHaveBeenCalled()
    expect(reconcileMock).not.toHaveBeenCalled()
})

test('rechecks update permission inside the transaction before storing credentials', async () => {
    seedPolicy()
    revoked = true
    await expect(
        updateAccessPolicyService({
            accessPolicyId: policyId,
            mode: 'authenticated',
            basicAuth: credentials,
        }),
    ).rejects.toThrow('permission revoked')
    expect(store.policies[0]?.mode).toBe('public')
    expect(store.accounts).toHaveLength(0)
    expect(reconcileMock).not.toHaveBeenCalled()
})

test('keeps account limits and duplicate-username errors in the policy save flow', async () => {
    seedPolicy('authenticated')
    store.accounts = Array.from({ length: 32 }, (_, index) => ({ username: `account${index}` }))
    await expect(
        updateAccessPolicyService({
            accessPolicyId: policyId,
            basicAuth: credentials,
        }),
    ).rejects.toThrow('basic_auth_account_limit')
    expect(store.accounts).toHaveLength(32)
    store.accounts = []
    accountFailure = {
        code: '23505',
        constraint: 'access_policy_basic_auth_accounts_policy_username_unique',
    }
    await expect(
        updateAccessPolicyService({
            accessPolicyId: policyId,
            basicAuth: credentials,
        }),
    ).rejects.toThrow('basic_auth_username_conflict')
    expect(store.accounts).toHaveLength(0)
    expect(reconcileMock).not.toHaveBeenCalled()
})
