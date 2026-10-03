import { chmod, readFile, writeFile } from 'node:fs/promises'
import { stateSchema } from './fixture.validation.ts'
import type { ContextStage, FixtureCommand, FixtureState } from './Types/fixture.types.ts'

const statePath = '/tmp/rentnerproxy-reliability-fixture.json'

export class FixtureContextError extends Error {
    constructor(
        readonly contextStage: ContextStage,
        readonly diagnosticCode: string,
    ) {
        super('fixture_auth_unavailable')
    }
}

function contextDiagnostic(error: unknown): string {
    const codes = new Set([
        'EACCES',
        'EPERM',
        'EROFS',
        'ENOENT',
        'ECONNREFUSED',
        'ETIMEDOUT',
        '42501',
        '40P01',
        '28P01',
        '23505',
        '42P01',
        '42703',
        '42704',
        '08001',
        '08003',
        '08006',
        '57P01',
        '53300',
        'user_not_active',
        'service_unavailable',
    ])
    let cause = error
    for (let depth = 0; depth < 3; depth += 1) {
        if (!cause || typeof cause !== 'object') break
        const detail = cause as { code?: unknown; errno?: unknown; cause?: unknown }
        for (const code of [detail.code, detail.errno])
            if (typeof code === 'string' && codes.has(code)) return code
        cause = detail.cause
    }
    return 'unexpected'
}

export async function createFixtureContext(command: FixtureCommand) {
    if (
        process.env.RENTNERPROXY_RELIABILITY_ISOLATED !== command.runId ||
        process.platform !== 'linux'
    )
        throw new Error('isolation_guard')
    const [
        { eq },
        { requestHandler },
        { SESSION_COOKIE_NAME },
        { SYSTEM_ROLES },
        schema,
        { getAuthDatabase },
        { createSessionService },
        registry,
        hosts,
        redirects,
        policies,
        basicAuth,
        runtime,
        certificates,
        valkey,
        jobs,
    ] = await Promise.all([
        import('drizzle-orm'),
        import('@tanstack/react-start/server'),
        import('../../web/src/config/auth.config.ts'),
        import('../../web/src/config/permissions.config.ts'),
        import('../../web/src/db/schema.ts'),
        import('../../web/src/server/Auth/Core/database.server.ts'),
        import('../../web/src/server/Auth/Access/sessions.service.ts'),
        import('../../web/src/server/Auth/Access/registry.service.ts'),
        import('../../web/src/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'),
        import('../../web/src/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'),
        import('../../web/src/server/Admin/AccessPolicyManagement/access-policies.service.ts'),
        import('../../web/src/server/Admin/AccessPolicyManagement/basic-auth.service.ts'),
        import('../../web/src/server/ProxyRuntime/proxy-runtime.service.ts'),
        import('../../web/src/server/Admin/CertificateManagement/certificates.service.ts'),
        import('../../web/src/server/Valkey/client.server.ts'),
        import('../../web/src/server/Admin/ProxyHostManagement/certificate-jobs.service.ts'),
    ])
    const database = getAuthDatabase()
    let state: FixtureState = { runId: command.runId }
    try {
        state = stateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
        if (state.runId !== command.runId) throw new Error('state_run_mismatch')
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            await database.$client.close()
            throw new Error('invalid_fixture_state', { cause: error })
        }
    }
    let contextStage: ContextStage = 'registry'
    try {
        await database.transaction(registry.ensureAuthorizationRegistryInTransaction)
        contextStage = 'actor-read'
        const email = command.runId + '@reliability.invalid'
        let actor = (
            await database
                .select({ id: schema.users.id })
                .from(schema.users)
                .where(eq(schema.users.email, email))
        ).at(0)
        if (!actor) {
            contextStage = 'actor-create'
            actor = (
                await database
                    .insert(schema.users)
                    .values({
                        displayName: 'Reliability fixture owner',
                        email,
                        emailVerifiedAt: new Date(),
                        status: 'active',
                    })
                    .returning({ id: schema.users.id })
            ).at(0)
            const owner = (
                await database
                    .select({ id: schema.roles.id })
                    .from(schema.roles)
                    .where(eq(schema.roles.key, SYSTEM_ROLES.OWNER))
            ).at(0)
            if (!actor || !owner) throw new Error('fixture_owner_unavailable')
            await database.insert(schema.userRoles).values({ userId: actor.id, roleId: owner.id })
        }
        contextStage = 'session-delete'
        await database.delete(schema.sessions).where(eq(schema.sessions.userId, actor.id))
        contextStage = 'session-create'
        state.session = (await createSessionService(actor.id)).token
        contextStage = 'state-write'
        await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
        contextStage = 'state-chmod'
        await chmod(statePath, 0o600)
    } catch (error) {
        valkey.closeValkeyClient()
        await database.$client.close()
        throw new FixtureContextError(contextStage, contextDiagnostic(error))
    }
    async function authorized<T>(operation: () => Promise<T>): Promise<T> {
        let outcome: { value: T } | { error: unknown } | undefined
        const handler = requestHandler(async () => {
            try {
                outcome = { value: await operation() }
            } catch (error) {
                outcome = { error }
            }
            return new Response(null, { status: 204 })
        })
        await handler(
            new Request('http://localhost/', {
                headers: { cookie: SESSION_COOKIE_NAME + '=' + state.session },
            }),
            {},
        )
        if (!outcome) throw new Error('fixture_request_unavailable')
        if ('error' in outcome) throw outcome.error
        return outcome.value
    }
    const domain =
        command.certificateDomain ?? state.domain ?? 'reliability-' + command.runId + '.test'
    if (state.domain && state.domain !== domain) {
        valkey.closeValkeyClient()
        await database.$client.close()
        throw new Error('fixture_domain_mismatch')
    }
    state.domain = domain
    const hostInput = {
        domains: [domain],
        enabled: true,
        forwardScheme: 'http' as const,
        forwardHost: 'host.docker.internal',
        forwardPort: command.upstreamPort,
    }
    async function save() {
        await writeFile(statePath, JSON.stringify(state), { mode: 0o600 })
    }
    async function close() {
        await runtime.stopProxyRuntimeReconciliation()
        valkey.closeValkeyClient()
        await database.$client.close()
    }
    return {
        command,
        state,
        authorized,
        hosts,
        redirects,
        policies,
        basicAuth,
        runtime,
        certificates,
        jobs,
        database,
        domain,
        hostInput,
        save,
        close,
    }
}
