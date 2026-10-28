import { consumeRateLimit, RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import { DOMAIN_DIAGNOSTICS_RATE_LIMIT } from '@/config/domain-diagnostics.config.ts'
import { expect, test } from 'bun:test'
import { createDomainDiagnosticsService } from '@/server/RuntimeDiagnostics/domain-diagnostics.service.ts'
import { DomainDiagnosticsError } from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { DomainDiagnosticsDependencies } from '@/server/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import {
    domainDiagnosticsFixture,
    domainDiagnosticsInput,
    diagnosticRevision,
} from '@/tests/lib/RuntimeDiagnostics/domain-diagnostics.fixture.ts'

function harness() {
    const calls: string[] = []
    const context = { enabled: true, proof: 'private-proof-hash', revision: diagnosticRevision }
    const dependencies: {
        -readonly [K in keyof DomainDiagnosticsDependencies]: DomainDiagnosticsDependencies[K]
    } = {
        requireActor: async (permission) => {
            calls.push(permission)
            return { id: 'actor' }
        },
        rateLimit: async (id) => {
            calls.push('limit:' + id)
        },
        readContext: async () => {
            calls.push('context')
            return context
        },
        inspect: async () => {
            calls.push('inspect')
            return domainDiagnosticsFixture()
        },
        now: () => new Date('2026-10-28T10:00:00Z'),
    }
    return { calls, context, dependencies }
}

test('permission precedes every data/network read and is rechecked after controller work', async () => {
    const { calls, dependencies } = harness()
    const result = await createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput)
    expect(calls).toEqual([
        'proxy_hosts.view',
        'limit:actor',
        'context',
        'inspect',
        'proxy_hosts.view',
        'context',
    ])
    expect(result).toEqual(domainDiagnosticsFixture())
    dependencies.requireActor = async () => {
        throw new AuthDomainError('permission_denied', 'PRIVATE')
    }
    calls.length = 0
    await expect(
        createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput),
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(calls).toEqual([])
})

test('disabled and missing/foreign host selections never reach controller probes', async () => {
    const { calls, dependencies, context } = harness()
    context.enabled = false
    const result = await createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput)
    expect(result.stages.configuration.code).toBe('host_not_active')
    expect(result.stages.dns.code).toBe('skipped')
    expect(calls).not.toContain('inspect')
    dependencies.readContext = async () => {
        throw new DomainDiagnosticsError('invalid_input')
    }
    await expect(
        createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(calls).not.toContain('inspect')
})

test.each(['proof', 'revision', 'disabled', 'revoked', 'deleted'] as const)(
    'postflight %s changes reject observations rather than releasing stale results',
    async (change) => {
        const { dependencies, context } = harness()
        let reads = 0
        dependencies.readContext = async () => {
            reads++
            if (reads === 1) return { ...context }
            if (change === 'deleted') throw new DomainDiagnosticsError('invalid_input')
            return {
                ...context,
                ...(change === 'proof'
                    ? { proof: 'changed' }
                    : change === 'revision'
                      ? { revision: 'sha256:' + 'b'.repeat(64) }
                      : change === 'disabled'
                        ? { enabled: false }
                        : {}),
            }
        }
        let authorizations = 0
        dependencies.requireActor = async () => {
            authorizations++
            if (change === 'revoked' && authorizations > 1)
                throw new AuthDomainError('permission_denied', 'PRIVATE')
            return { id: 'actor' }
        }
        await expect(
            createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput),
        ).rejects.toMatchObject({
            code:
                change === 'revoked'
                    ? 'permission_denied'
                    : change === 'deleted'
                      ? 'invalid_input'
                      : 'configuration_changed',
        })
    },
)

test('rate limits and aborted requests stop before configuration/controller access; transport abort is forwarded', async () => {
    const { calls, dependencies } = harness()
    const cancellation = new AbortController()
    cancellation.abort()
    await expect(
        createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput, cancellation.signal),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(calls).toEqual([])
    dependencies.rateLimit = async () => {
        throw new DomainDiagnosticsError('rate_limited')
    }
    await expect(
        createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput),
    ).rejects.toMatchObject({ code: 'rate_limited' })
    expect(calls).not.toContain('context')
    dependencies.rateLimit = async () => undefined
    const active = new AbortController()
    dependencies.inspect = async (_input, signal) => {
        expect(signal).toBe(active.signal)
        active.abort()
        return domainDiagnosticsFixture()
    }
    await expect(
        createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput, active.signal),
    ).rejects.toMatchObject({ code: 'aborted' })
})

test('unexpected dependency errors expose only a closed machine code', async () => {
    const { dependencies } = harness()
    dependencies.inspect = async () => {
        throw new Error('postgres://PRIVATE:SECRET@internal/token')
    }
    await expect(
        createDomainDiagnosticsService(dependencies)(domainDiagnosticsInput),
    ).rejects.toMatchObject({ code: 'runtime_unavailable', message: 'runtime_unavailable' })
})

test('the declarative actor policy allows ten requests per minute and isolates different actors', async () => {
    const counts = new Map<string, number>()
    const { dependencies } = harness()
    let actor = '0198d98a-0000-7000-8000-000000000001'
    dependencies.requireActor = async () => ({ id: actor })
    dependencies.rateLimit = async (id) => {
        try {
            await consumeRateLimit(
                { ...DOMAIN_DIAGNOSTICS_RATE_LIMIT, identifier: id },
                {
                    getClient: () => ({
                        ping: async () => 'PONG',
                        send: async (_command, args) => {
                            const key = String(args[2])
                            const count = (counts.get(key) ?? 0) + 1
                            counts.set(key, count)
                            return [count, 60_000]
                        },
                    }),
                },
            )
        } catch (error) {
            if (error instanceof RateLimitError) throw new DomainDiagnosticsError('rate_limited')
            throw error
        }
    }
    const diagnose = createDomainDiagnosticsService(dependencies)
    await Promise.all(Array.from({ length: 10 }, () => diagnose(domainDiagnosticsInput)))
    await expect(diagnose(domainDiagnosticsInput)).rejects.toMatchObject({ code: 'rate_limited' })
    actor = '0198d98a-0000-7000-8000-000000000002'
    await expect(diagnose(domainDiagnosticsInput)).resolves.toEqual(domainDiagnosticsFixture())
    expect(DOMAIN_DIAGNOSTICS_RATE_LIMIT.windowMs).toBe(60_000)
    expect(DOMAIN_DIAGNOSTICS_RATE_LIMIT.limit).toBe(10)
})

test('redirect diagnostics require redirect view on both sides of the controller call', async () => {
    const { calls, dependencies } = harness()
    const fixture = domainDiagnosticsFixture()
    dependencies.inspect = async () => ({
        ...fixture,
        hostType: 'redirect',
        stages: {
            ...fixture.stages,
            upstream: {
                status: 'not_applicable',
                code: 'redirect_host',
                durationMs: 0,
                addresses: [],
                httpStatus: null,
            },
            tls: {
                status: 'not_applicable',
                code: 'redirect_host',
                durationMs: 0,
                addresses: [],
                httpStatus: null,
            },
        },
    })
    const result = await createDomainDiagnosticsService(dependencies)({
        ...domainDiagnosticsInput,
        hostType: 'redirect',
    })
    expect(result.hostType).toBe('redirect')
    expect(calls.filter((call) => call.endsWith('.view'))).toEqual([
        'redirect_hosts.view',
        'redirect_hosts.view',
    ])
    expect(calls).not.toContain('proxy_hosts.view')
})
