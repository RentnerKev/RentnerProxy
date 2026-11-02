import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { permissions, rolePermissions, roles, sessions, userRoles, users } from '@/db/schema.ts'
import { authenticateOidcIdentityService } from '@/server/Auth/Oidc/oidc-login.service.ts'
import { getOidcClientConfigurationService } from '@/server/Auth/Oidc/oidc-providers.service.ts'
import { requireOidcAuthenticationInTransaction } from '@/server/Auth/Oidc/oidc-authentication.server.ts'
import { issuePasswordResetService } from '@/server/Auth/PasswordReset/password-reset.service.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getUserRoleKeysInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import {
    resolveOidcAccountInTransaction,
    synchronizeOidcAccountInTransaction,
    validateOidcAccountPoliciesInTransaction,
    lockOidcAccountPolicyInTransaction,
} from '@/server/Auth/Oidc/oidc-accounts.service.ts'
import {
    buildStoredOidcSettings,
    lockStoredOidcSettings,
    writeStoredOidcSettings,
} from '@/server/Auth/Oidc/oidc-settings.server.ts'
import type { StoredOidcSettings } from '@/server/Auth/Oidc/Types/oidc-provider.types.ts'
import type { OidcClientConfiguration } from '@/server/Auth/Oidc/Types/oidc.types.ts'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const providerId = randomUUID()
const roleIds = [randomUUID(), randomUUID()]
const roleKeys = [`oidc-default-${randomUUID()}`, `oidc-mapped-${randomUUID()}`]
const createdUsers: string[] = []
let snapshot: StoredOidcSettings | undefined
let originalKey: string | undefined
let permissionId: string | undefined
let createdOwnerRoleId: string | undefined
let configuration: OidcClientConfiguration

beforeAll(async () => {
    if (!enabled) return
    if (new URL(getDatabaseUrl()!).pathname !== '/rentnerproxy_upstream_test')
        throw new Error('Account policy tests require the disposable database.')
    if (process.env.APP_ENCRYPTION_KEY_FILE)
        throw new Error('Account policy tests require a synthetic inline key.')
    originalKey = process.env.APP_ENCRYPTION_KEY
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString('base64')
    const db = getAuthDatabase()
    await db.transaction(async (transaction) => {
        await lockOidcAccountPolicyInTransaction(transaction)
        snapshot = await lockStoredOidcSettings(transaction)
        let [permission] = await transaction
            .select({ id: permissions.id })
            .from(permissions)
            .where(eq(permissions.key, 'app.access'))
            .limit(1)
        if (!permission) {
            permissionId = randomUUID()
            ;[permission] = await transaction
                .insert(permissions)
                .values({ id: permissionId, key: 'app.access', name: 'Account policy test' })
                .returning({ id: permissions.id })
        }
        await transaction.insert(roles).values(
            roleIds.map((id, index) => ({
                id,
                key: roleKeys[index]!,
                name: `Account policy ${index}`,
                isSystem: false,
            })),
        )
        await transaction
            .insert(rolePermissions)
            .values({ roleId: roleIds[0]!, permissionId: permission!.id })
        const saved = await buildStoredOidcSettings(snapshot, {
            expectedRevision: snapshot.revision,
            providers: [
                ...snapshot.providers.map(
                    ({ revision: _revision, clientSecret: _secret, ...provider }) => provider,
                ),
                {
                    id: providerId,
                    name: 'Account policy integration',
                    issuer: 'https://account-policy.example.test',
                    enabled: true,
                    clientId: 'integration',
                    clientSecret: 'synthetic-only',
                    tokenEndpointAuthMethod: 'client_secret_basic',
                    allowedEndpointOrigins: ['https://account-policy.example.test'],
                    allowedPrivateCidrs: [],
                    bindings: [],
                    accountPolicy: {
                        provisioning: true,
                        groupClaim: 'groups',
                        defaultRoleKeys: [roleKeys[0]!],
                        groupRoleMappings: [{ group: 'Operators', roleKeys: [roleKeys[1]!] }],
                    },
                },
            ],
        })
        await writeStoredOidcSettings(transaction, saved)
        const provider = saved.providers.find((entry) => entry.id === providerId)!
        configuration = {
            providerId,
            revision: provider.revision,
            issuer: provider.issuer,
            clientId: provider.clientId,
            clientSecret: 'synthetic-only',
            tokenEndpointAuthMethod: provider.tokenEndpointAuthMethod,
            allowedEndpointOrigins: provider.allowedEndpointOrigins,
            allowedPrivateCidrs: [],
            groupClaim: 'groups',
        }
    })
})

afterAll(async () => {
    if (!enabled || !snapshot) return
    await getAuthDatabase().transaction(async (transaction) => {
        await lockOidcAccountPolicyInTransaction(transaction)
        const current = await lockStoredOidcSettings(transaction)
        await writeStoredOidcSettings(transaction, { ...snapshot!, revision: current.revision + 1 })
        if (createdUsers.length)
            await transaction.delete(users).where(inArray(users.id, createdUsers))
        await transaction.delete(roles).where(inArray(roles.id, roleIds))
        if (createdOwnerRoleId)
            await transaction.delete(roles).where(eq(roles.id, createdOwnerRoleId))
        if (permissionId)
            await transaction.delete(permissions).where(eq(permissions.id, permissionId))
    })
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY
    else process.env.APP_ENCRYPTION_KEY = originalKey
})

describe('OIDC account policy database invariants', () => {
    integrationTest(
        'provisions a passwordless active user, persists one binding, and removes absent-group grants',
        async () => {
            await getAuthDatabase().transaction(async (transaction) => {
                const identity = {
                    issuer: configuration.issuer,
                    subject: `new-${randomUUID()}`,
                    expiresAt: Date.now() + 60_000,
                    email: `${randomUUID()}@example.test`,
                    emailVerified: true,
                    groups: ['Operators'],
                }
                const proof = await resolveOidcAccountInTransaction(
                    transaction,
                    configuration,
                    identity,
                )
                createdUsers.push(proof.userId)
                const [user] = await transaction
                    .select()
                    .from(users)
                    .where(eq(users.id, proof.userId))
                expect(user?.status).toBe('active')
                expect(user?.passwordHash).toBeNull()
                expect(user?.oidcProviderId).toBe(providerId)
                expect(
                    (await getUserRoleKeysInTransaction(transaction, proof.userId)).toSorted(),
                ).toEqual(roleKeys.toSorted())
                const settings = await lockStoredOidcSettings(transaction)
                const provider = settings.providers.find((entry) => entry.id === providerId)!
                expect(provider.revision).toBe(proof.providerRevision)
                expect(provider.revision).toBe(configuration.revision)
                expect(proof.bindingGeneration).toBe(settings.revision)
                expect(
                    provider.bindings.filter((entry) => entry.userId === proof.userId),
                ).toHaveLength(1)
                const { groups: _groups, ...withoutGroups } = proof
                await synchronizeOidcAccountInTransaction(transaction, provider, withoutGroups)
                expect(await getUserRoleKeysInTransaction(transaction, proof.userId)).toEqual([
                    roleKeys[0]!,
                ])
            })
        },
    )
    integrationTest('requires verified email and refuses to link an existing email', async () => {
        const email = `${randomUUID()}@example.test`
        const [user] = await getAuthDatabase()
            .insert(users)
            .values({ displayName: 'Local collision', email, status: 'active' })
            .returning({ id: users.id })
        createdUsers.push(user!.id)
        for (const identity of [
            {
                issuer: configuration.issuer,
                subject: randomUUID(),
                expiresAt: Date.now() + 60_000,
                email,
                emailVerified: true,
            },
            {
                issuer: configuration.issuer,
                subject: randomUUID(),
                expiresAt: Date.now() + 60_000,
                email: `${randomUUID()}@example.test`,
                emailVerified: false,
            },
        ]) {
            // oxlint-disable-next-line no-await-in-loop -- Each rejected transaction rolls back independently.
            await expect(
                getAuthDatabase().transaction(async (transaction) => {
                    await lockOidcAccountPolicyInTransaction(transaction)
                    const settings = await lockStoredOidcSettings(transaction)
                    const provider = settings.providers.find((entry) => entry.id === providerId)!
                    await resolveOidcAccountInTransaction(
                        transaction,
                        { ...configuration, revision: provider.revision },
                        identity,
                    )
                }),
            ).rejects.toThrow()
        }
        expect(
            await getAuthDatabase().select().from(userRoles).where(eq(userRoles.userId, user!.id)),
        ).toHaveLength(0)
    })
    integrationTest('rejects provider management of a local account', async () => {
        const [user] = await getAuthDatabase()
            .insert(users)
            .values({
                displayName: 'Local target',
                email: `${randomUUID()}@example.test`,
                status: 'active',
            })
            .returning({ id: users.id })
        createdUsers.push(user!.id)
        await expect(
            getAuthDatabase().transaction(async (transaction) => {
                await lockOidcAccountPolicyInTransaction(transaction)
                const settings = await lockStoredOidcSettings(transaction)
                const provider = settings.providers.find((entry) => entry.id === providerId)!
                await validateOidcAccountPoliciesInTransaction(transaction, [
                    {
                        ...provider,
                        bindings: [
                            { subject: 'local-target', userId: user!.id, roleSource: 'provider' },
                        ],
                    },
                ])
            }),
        ).rejects.toThrow()
    })
    integrationTest(
        'serializes concurrent provisioning without duplicate identities or users',
        async () => {
            const current = await getOidcClientConfigurationService(providerId)
            const identity = {
                issuer: current.issuer,
                subject: randomUUID(),
                expiresAt: Date.now() + 60_000,
                email: `${randomUUID()}@example.test`,
                emailVerified: true,
            }
            const results = await Promise.allSettled(
                [1, 2].map(() =>
                    getAuthDatabase().transaction((transaction) =>
                        resolveOidcAccountInTransaction(transaction, current, identity),
                    ),
                ),
            )
            const successful = results.filter((result) => result.status === 'fulfilled')
            expect(successful).toHaveLength(2)
            const proof = successful[0]!.value
            expect(successful[1]!.value.userId).toBe(proof.userId)
            expect(successful[1]!.value.bindingGeneration).toBe(proof.bindingGeneration)
            createdUsers.push(proof.userId)
            const matches = await getAuthDatabase()
                .select({ id: users.id })
                .from(users)
                .where(eq(users.email, identity.email))
            expect(matches).toHaveLength(1)
            expect(await issuePasswordResetService(identity.email)).toBeNull()
        },
    )
    integrationTest(
        'new identities preserve earlier proofs while relink generations invalidate them',
        async () => {
            const current = await getOidcClientConfigurationService(providerId)
            await getAuthDatabase().transaction(async (transaction) => {
                const first = await resolveOidcAccountInTransaction(transaction, current, {
                    issuer: current.issuer,
                    subject: randomUUID(),
                    email: `${randomUUID()}@example.test`,
                    emailVerified: true,
                    expiresAt: Date.now() + 60_000,
                })
                createdUsers.push(first.userId)
                const second = await resolveOidcAccountInTransaction(transaction, current, {
                    issuer: current.issuer,
                    subject: randomUUID(),
                    email: `${randomUUID()}@example.test`,
                    emailVerified: true,
                    expiresAt: Date.now() + 60_000,
                })
                createdUsers.push(second.userId)
                expect(first.providerRevision).toBe(current.revision)
                expect(second.providerRevision).toBe(current.revision)
                expect(second.bindingGeneration).toBeGreaterThan(first.bindingGeneration!)
                await requireOidcAuthenticationInTransaction(transaction, first)
                const settings = await lockStoredOidcSettings(transaction)
                const revision = settings.revision + 1
                await writeStoredOidcSettings(transaction, {
                    ...settings,
                    revision,
                    providers: settings.providers.map((provider) =>
                        provider.id === providerId
                            ? Object.assign({}, provider, {
                                  bindings: provider.bindings.map((binding) =>
                                      binding.userId === first.userId
                                          ? Object.assign({}, binding, { generation: revision })
                                          : binding,
                                  ),
                              })
                            : provider,
                    ),
                })
                await expect(
                    requireOidcAuthenticationInTransaction(transaction, first),
                ).rejects.toMatchObject({ code: 'user_not_active' })
                await requireOidcAuthenticationInTransaction(transaction, second)
            })
        },
    )
    integrationTest('rejects external accounts downgraded to local role control', async () => {
        await expect(
            getAuthDatabase().transaction(async (transaction) => {
                await lockOidcAccountPolicyInTransaction(transaction)
                const settings = await lockStoredOidcSettings(transaction)
                const provider = settings.providers.find((entry) => entry.id === providerId)!
                await validateOidcAccountPoliciesInTransaction(transaction, [
                    {
                        ...provider,
                        bindings: provider.bindings.map((binding) =>
                            Object.assign({}, binding, { roleSource: 'local' as const }),
                        ),
                    },
                ])
            }),
        ).rejects.toThrow()
    })
    integrationTest('rejects management of current owners and disabled managed login', async () => {
        let [ownerRole] = await getAuthDatabase()
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, 'owner'))
            .limit(1)
        if (!ownerRole) {
            createdOwnerRoleId = randomUUID()
            ;[ownerRole] = await getAuthDatabase()
                .insert(roles)
                .values({ id: createdOwnerRoleId, key: 'owner', name: 'Owner', isSystem: true })
                .returning({ id: roles.id })
        }
        const [owner] = await getAuthDatabase()
            .insert(users)
            .values({
                displayName: 'External owner guard',
                email: `${randomUUID()}@example.test`,
                status: 'active',
                oidcProviderId: providerId,
            })
            .returning({ id: users.id })
        createdUsers.push(owner!.id)
        await getAuthDatabase()
            .insert(userRoles)
            .values({ userId: owner!.id, roleId: ownerRole!.id })
        await expect(
            getAuthDatabase().transaction(async (transaction) => {
                await lockOidcAccountPolicyInTransaction(transaction)
                const settings = await lockStoredOidcSettings(transaction)
                const provider = settings.providers.find((entry) => entry.id === providerId)!
                await validateOidcAccountPoliciesInTransaction(transaction, [
                    {
                        ...provider,
                        bindings: [
                            {
                                subject: 'external-owner',
                                userId: owner!.id,
                                roleSource: 'provider',
                            },
                        ],
                    },
                ])
            }),
        ).rejects.toThrow()
        const userId = createdUsers[0]!
        await getAuthDatabase()
            .update(users)
            .set({ status: 'disabled' })
            .where(eq(users.id, userId))
        const subject = await getAuthDatabase().transaction(async (transaction) => {
            await lockOidcAccountPolicyInTransaction(transaction)
            const settings = await lockStoredOidcSettings(transaction)
            return settings.providers
                .find((entry) => entry.id === providerId)!
                .bindings.find((binding) => binding.userId === userId)!.subject
        })
        const denied = await authenticateOidcIdentityService(
            await getOidcClientConfigurationService(providerId),
            { issuer: configuration.issuer, subject, expiresAt: Date.now() + 60_000 },
        )
        expect(denied.success).toBe(false)
        const [disabled] = await getAuthDatabase()
            .select({ status: users.status })
            .from(users)
            .where(eq(users.id, userId))
        expect(disabled?.status).toBe('disabled')
    })
    integrationTest(
        'commits complete group-grant removal and session revocation when authentication is denied',
        async () => {
            const identity = {
                issuer: configuration.issuer,
                subject: randomUUID(),
                expiresAt: Date.now() + 60_000,
                email: `${randomUUID()}@example.test`,
                emailVerified: true,
                groups: ['Operators'],
            }
            const login = await authenticateOidcIdentityService(
                await getOidcClientConfigurationService(providerId),
                identity,
            )
            if (!login.success || login.requiresTwoFactor)
                throw new Error('Expected provisioned OIDC session.')
            createdUsers.push(login.user.id)
            await getAuthDatabase().transaction(async (transaction) => {
                await lockOidcAccountPolicyInTransaction(transaction)
                const settings = await lockStoredOidcSettings(transaction)
                const revision = settings.revision + 1
                await writeStoredOidcSettings(transaction, {
                    ...settings,
                    revision,
                    providers: settings.providers.map((provider) =>
                        provider.id === providerId
                            ? Object.assign({}, provider, {
                                  revision,
                                  accountPolicy: {
                                      provisioning: true,
                                      groupClaim: 'groups',
                                      defaultRoleKeys: [],
                                      groupRoleMappings: [
                                          { group: 'Operators', roleKeys: [roleKeys[0]!] },
                                      ],
                                  },
                              })
                            : provider,
                    ),
                })
            })
            const { groups: _groups, ...missingGroups } = identity
            const denied = await authenticateOidcIdentityService(
                await getOidcClientConfigurationService(providerId),
                missingGroups,
            )
            expect(denied.success).toBe(false)
            expect(
                await getAuthDatabase()
                    .select()
                    .from(userRoles)
                    .where(eq(userRoles.userId, login.user.id)),
            ).toHaveLength(0)
            const revoked = await getAuthDatabase()
                .select({ id: sessions.id })
                .from(sessions)
                .where(eq(sessions.id, login.session.id))
            expect(revoked).toHaveLength(0)
        },
    )
})
