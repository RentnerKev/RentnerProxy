import { createFixtureContext, FixtureContextError } from './fixture-context.ts'
import { commandSchema } from './fixture.validation.ts'
import type { FixtureContext } from './Types/fixture.types.ts'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { CERTIFICATE_ERROR_CODES } from '../../web/src/config/certificates.config.ts'

const safeCodes = new Set<string>([
    ...CERTIFICATE_ERROR_CODES,
    'host_changed',
    'host_deleted',
    'permission_revoked',
    'certificate_deleted',
    'certificate_used_elsewhere',
    'idempotency_conflict',
    'job_not_found',
    'isolation_guard',
    'state_run_mismatch',
    'invalid_fixture_state',
    'fixture_auth_unavailable',
    'fixture_domain_mismatch',
    'fixture_request_unavailable',
    'fixture_not_prepared',
    'temporary_already_exists',
    'oversized_pem',
    'unsupported_core_phase',
    'forward_auth_not_prepared',
    'oversized_input',
    'fixture_owner_unavailable',
    'interrupted_apply_not_observed',
    'invalid_interrupted_phase',
])
function safeErrorCode(error: unknown): string {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return 'invalid_input'
    if (error instanceof Error && safeCodes.has(error.message)) return error.message
    if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        safeCodes.has(error.code)
    )
        return error.code
    return 'fixture_failed'
}
function safeJob(job: Awaited<ReturnType<FixtureContext['jobs']['getCertificateJobService']>>) {
    return {
        id: job.id,
        stage: job.stage,
        certificateId: job.certificateId,
        proxyHostId: job.proxyHostId,
        errorCode: job.lastErrorCode && safeCodes.has(job.lastErrorCode) ? job.lastErrorCode : null,
        retryAvailable:
            job.stage !== 'applied' &&
            (job.stage === 'failed' ||
                job.stage === 'needs_attention' ||
                job.lastErrorCode !== null),
    }
}
async function readFixtureJobs(context: FixtureContext) {
    const [{ eq }, { certificateJobs }] = await Promise.all([
        import('drizzle-orm'),
        import('../../web/src/db/schema.ts'),
    ])
    const persisted = context.state.proxyId
        ? await context.database
              .select({ stage: certificateJobs.stage })
              .from(certificateJobs)
              .where(eq(certificateJobs.proxyHostId, context.state.proxyId))
        : []
    const visible = await context.authorized(context.jobs.getCertificateJobProgressService)
    const current = context.state.jobId
        ? await context.authorized(() =>
              context.jobs.getCertificateJobService(context.state.jobId!),
          )
        : null
    return {
        count: visible.length,
        persistedJobCounts: {
            total: persisted.length,
            nonApplied: persisted.filter((job) => job.stage !== 'applied').length,
        },
        jobs: visible.map(safeJob),
        currentJob: current ? safeJob(current) : null,
    }
}
async function readFixtureCertificates(context: FixtureContext) {
    return (await context.authorized(context.certificates.getCertificatesService)).map(
        (certificate) => ({
            id: certificate.id,
            status: certificate.status,
            source: certificate.source,
            operation: certificate.operation,
            operationStage: certificate.currentOperation?.stage ?? null,
            fingerprint:
                certificate.fingerprint && /^sha256:[a-f0-9]{64}$/u.test(certificate.fingerprint)
                    ? certificate.fingerprint
                    : null,
            errorCode:
                certificate.lastErrorCode && safeCodes.has(certificate.lastErrorCode)
                    ? certificate.lastErrorCode
                    : null,
            assignedHostCount: certificate.assignedHostCount,
        }),
    )
}
function required(value: string | undefined): string {
    if (!value) throw new Error('fixture_not_prepared')
    return value
}
export async function executeCoreFixture(
    context: FixtureContext,
): Promise<Record<string, unknown>> {
    const {
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
        domain,
        hostInput,
        save,
    } = context
    let mutationStatus: 'applied' | 'pending' | undefined
    let detail: Record<string, unknown> = {}
    if (command.interruptedApply) {
        if (command.phase !== 'proxy-update') throw new Error('invalid_interrupted_phase')
        await runtime.reconcileProxyConfigurationService.stop()
    }
    switch (command.phase) {
        case 'prepare': {
            const existingHosts = await authorized(hosts.getProxyHostsService)
            state.proxyId = existingHosts.find((host) => host.domains.includes(domain))?.id
            if (!state.proxyId) {
                state.proxyId = (await authorized(() => hosts.createProxyHostService(hostInput))).id
                await save()
            }
            state.policyId = (await authorized(policies.getAccessPoliciesService)).find(
                (policy) => policy.name === 'Reliability ' + command.runId,
            )?.id
            if (!state.policyId) {
                state.policyId = (
                    await authorized(() =>
                        policies.createAccessPolicyService({
                            name: 'Reliability ' + command.runId,
                            mode: 'public',
                            combination: null,
                        }),
                    )
                ).accessPolicyId
                await save()
            }
            state.policyHostId = existingHosts.find((host) =>
                host.domains.includes('policy-' + domain),
            )?.id
            if (!state.policyHostId) {
                state.policyHostId = (
                    await authorized(() =>
                        hosts.createProxyHostService({
                            ...hostInput,
                            domains: ['policy-' + domain],
                            accessPolicyId: state.policyId,
                        }),
                    )
                ).id
                await save()
            }
            state.redirectId = (await authorized(redirects.getRedirectHostsService)).find((host) =>
                host.domains.includes('redirect-' + domain),
            )?.id
            if (!state.redirectId) {
                state.redirectId = (
                    await authorized(() =>
                        redirects.createRedirectHostService({
                            domains: ['redirect-' + domain],
                            destination: 'http://' + domain + '/initial',
                            statusCode: 302,
                            preserveRequestUri: true,
                            enabled: true,
                            certificateId: null,
                        }),
                    )
                ).id
                await save()
            }
            break
        }
        case 'proxy-update':
            mutationStatus = (
                await authorized(() =>
                    hosts.updateProxyHostService({
                        ...hostInput,
                        proxyHostId: required(state.proxyId),
                        forwardPort: command.secondaryPort,
                        ...(command.resetTls ? { certificateId: null, forceHttps: false } : {}),
                    }),
                )
            ).runtimeStatus
            if (command.interruptedApply) {
                const { applyProxyRuntimeConfiguration } =
                    await import('../../web/src/server/Controller/proxy.server.ts')
                const snapshot = await runtime.getProxyRuntimeSnapshotService()
                const applied = await applyProxyRuntimeConfiguration(snapshot)
                if (applied !== null) throw new Error('interrupted_apply_not_observed')
                detail.interruptedApplyObserved = true
            }
            break
        case 'proxy-disable':
            mutationStatus = (
                await authorized(() => hosts.disableProxyHostService(required(state.proxyId)))
            ).runtimeStatus
            break
        case 'proxy-enable':
            mutationStatus = (
                await authorized(() => hosts.enableProxyHostService(required(state.proxyId)))
            ).runtimeStatus
            break
        case 'rapid-update': {
            const outcomes = await Promise.all(
                Array.from({ length: command.concurrency }, (_, index) =>
                    authorized(() =>
                        hosts.updateProxyHostService({
                            ...hostInput,
                            proxyHostId: required(state.proxyId),
                            forwardPort: index % 2 ? command.upstreamPort : command.secondaryPort,
                        }),
                    ).then((result) => result.runtimeStatus),
                ),
            )
            mutationStatus = outcomes.includes('pending') ? 'pending' : 'applied'
            detail = { mutations: outcomes.length }
            break
        }
        case 'create-temporary':
            if (state.temporaryId) throw new Error('temporary_already_exists')
            state.temporaryId = (
                await authorized(() =>
                    hosts.createProxyHostService({
                        ...hostInput,
                        domains: ['temporary-' + domain],
                    }),
                )
            ).id
            break
        case 'delete-temporary':
            mutationStatus = (
                await authorized(() => hosts.deleteProxyHostService(required(state.temporaryId)))
            ).runtimeStatus
            delete state.temporaryId
            break
        case 'redirect-disable':
            mutationStatus = (
                await authorized(() =>
                    redirects.disableRedirectHostService(required(state.redirectId)),
                )
            ).runtimeStatus
            break
        case 'redirect-enable':
            mutationStatus = (
                await authorized(() =>
                    redirects.enableRedirectHostService(required(state.redirectId)),
                )
            ).runtimeStatus
            break
        case 'redirect-delete':
            mutationStatus = (
                await authorized(() =>
                    redirects.deleteRedirectHostService(required(state.redirectId)),
                )
            ).runtimeStatus
            delete state.redirectId
            break
        case 'redirect-update':
            mutationStatus = (
                await authorized(() =>
                    redirects.updateRedirectHostService({
                        redirectHostId: required(state.redirectId),
                        domains: ['redirect-' + domain],
                        destination: 'http://' + domain + '/iteration-' + command.iteration,
                        statusCode: 307,
                        preserveRequestUri: true,
                        enabled: true,
                        certificateId: null,
                    }),
                )
            ).runtimeStatus
            break
        case 'policy-update': {
            const accessPolicyId = required(state.policyId)
            if (command.policyMode === 'authenticated') {
                const accounts = await authorized(() =>
                    basicAuth.getBasicAuthAccountsService({ accessPolicyId }),
                )
                state.accountId = accounts.find((account) => account.username === 'reliability')?.id
                const password = 'Reliability-fixture-' + command.runId + '-only'
                if (!state.accountId)
                    state.accountId = (
                        await authorized(() =>
                            basicAuth.createBasicAuthAccountService({
                                accessPolicyId,
                                username: 'reliability',
                                password,
                            }),
                        )
                    ).accountId
            }
            mutationStatus = (
                await authorized(() =>
                    policies.updateAccessPolicyService({
                        accessPolicyId,
                        name: 'Reliability ' + command.runId,
                        mode: command.policyMode,
                        combination: null,
                        ipRules:
                            command.policyMode === 'ip-restricted'
                                ? { defaultAction: 'deny', allow: ['192.0.2.0/24'], deny: [] }
                                : null,
                    }),
                )
            ).runtimeStatus
            break
        }
        case 'certificate-import': {
            const [certificatePem, privateKeyPem] = await Promise.all([
                readFile('/tmp/reliability-certificate.pem', 'utf8'),
                readFile('/tmp/reliability-certificate.key', 'utf8'),
            ])
            if (certificatePem.length > 131072 || privateKeyPem.length > 131072)
                throw new Error('oversized_pem')
            state.certificateId = await authorized(() =>
                certificates.importCertificateService({
                    name: 'Reliability ' + command.runId + ' ' + command.iteration,
                    certificatePem,
                    privateKeyPem,
                }),
            )
            detail = { certificateId: state.certificateId }
            break
        }
        case 'certificate-request':
            state.certificateId = await authorized(() =>
                certificates.requestCertificateService({
                    name: 'Reliability ACME ' + command.runId + ' ' + command.iteration,
                    domains: [command.certificateDomain ?? domain],
                    environment: command.certificateEnvironment,
                    challengeType: 'http-01',
                    acceptTerms: true,
                }),
            )
            detail = { certificateId: state.certificateId }
            break
        case 'certificate-renew':
            state.certificateId = command.certificateId ?? required(state.certificateId)
            await authorized(() =>
                certificates.renewCertificateService(required(state.certificateId)),
            )
            detail = { certificateId: state.certificateId }
            break
        case 'certificate-bind': {
            const current = (await authorized(hosts.getProxyHostsService)).find(
                (host) => host.id === state.proxyId,
            )
            if (!current) throw new Error('fixture_not_prepared')
            state.certificateId = command.certificateId ?? required(state.certificateId)
            mutationStatus = (
                await authorized(() =>
                    hosts.updateProxyHostService({
                        ...hostInput,
                        domains: command.certificateDomain
                            ? [command.certificateDomain]
                            : current.domains,
                        proxyHostId: current.id,
                        certificateId: state.certificateId,
                        forceHttps: true,
                    }),
                )
            ).runtimeStatus
            detail = { certificateId: state.certificateId }
            break
        }
        case 'binding-request': {
            const current = (await authorized(hosts.getProxyHostsService)).find(
                (host) => host.id === state.proxyId,
            )
            if (!current) throw new Error('fixture_not_prepared')
            if (command.certificateDomain && !current.domains.includes(command.certificateDomain)) {
                await authorized(() =>
                    hosts.updateProxyHostService({
                        ...hostInput,
                        proxyHostId: current.id,
                        domains: [required(command.certificateDomain)],
                    }),
                )
            }
            const latest = (await authorized(hosts.getProxyHostsService)).find(
                (host) => host.id === current.id,
            )
            if (!latest) throw new Error('fixture_not_prepared')
            const job = await authorized(() =>
                jobs.requestProxyHostCertificateService({
                    idempotencyKey: randomUUID(),
                    proxyHostId: latest.id,
                    expectedUpdatedAt: latest.updatedAt.toISOString(),
                    request: {
                        name: 'Reliability job ' + command.runId + ' ' + command.iteration,
                        environment: command.certificateEnvironment,
                        challengeType: 'http-01',
                        acceptTerms: true,
                    },
                }),
            )
            state.jobId = job.id
            state.certificateId = job.certificateId ?? undefined
            detail = { jobId: job.id, stage: job.stage, certificateId: job.certificateId }
            break
        }
        case 'binding-retry': {
            const job = await authorized(() =>
                jobs.retryCertificateJobService(required(state.jobId)),
            )
            detail = { currentJob: safeJob(job) }
            break
        }
        case 'certificate-delete': {
            const certificateId = command.certificateId ?? required(state.certificateId)
            const result = await authorized(() =>
                certificates.deleteCertificateService(certificateId),
            )
            detail = {
                certificateId,
                deleted: result.deleted,
                detachedHostCount: result.detachedHostCount,
            }
            mutationStatus = result.runtimeStatus
            if (result.deleted && certificateId === state.certificateId) delete state.certificateId
            break
        }
        case 'jobs-read':
            detail = await readFixtureJobs(context)
            break
        case 'certificates-read':
            detail = { certificates: await readFixtureCertificates(context) }
            break
        case 'durability-read':
            detail = {
                ...(await readFixtureJobs(context)),
                certificates: await readFixtureCertificates(context),
            }
            break
        case 'snapshot':
            break
        default:
            throw new Error('unsupported_core_phase')
    }
    await save()
    const [status, currentHosts, currentRedirects, currentPolicies, snapshot] = await Promise.all([
        authorized(() => runtime.getProxyRuntimeStatusService()),
        authorized(hosts.getProxyHostsService),
        authorized(redirects.getRedirectHostsService),
        authorized(policies.getAccessPoliciesService),
        runtime.getProxyRuntimeSnapshotService(),
    ])
    const proxy = currentHosts.find((host) => host.id === state.proxyId)
    const redirect = currentRedirects.find((host) => host.id === state.redirectId)
    return {
        ...detail,
        runId: command.runId,
        phase: command.phase,
        proxyId: state.proxyId,
        policyId: state.policyId,
        policyHostId: state.policyHostId,
        redirectId: state.redirectId,
        temporaryId: state.temporaryId,
        domain,
        desiredRevision: snapshot.revision,
        durableCounts: {
            proxyHosts: currentHosts.length,
            redirects: currentRedirects.length,
            policies: currentPolicies.length,
        },
        boundCertificateId: proxy?.certificateId ?? null,
        runtimeStatus: status,
        mutationStatus,
        expected: {
            enabled: proxy?.enabled,
            forwardPort: proxy?.forwardPort,
            policyMode: currentPolicies.find((policy) => policy.id === state.policyId)?.mode,
            redirectDestination: redirect?.destination,
            redirectEnabled: redirect?.enabled,
            forceHttps: proxy?.forceHttps,
            certificateId: proxy?.certificateId ?? null,
            redirectStatus: redirect?.statusCode,
        },
    }
}

export async function runFixture(
    extension?: (context: FixtureContext) => Promise<Record<string, unknown>>,
) {
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info,
        debug: console.debug,
    }
    console.log = console.warn = console.error = console.info = console.debug = () => undefined
    let context: FixtureContext | undefined
    let executionStage: 'input' | 'context' | 'command' = 'input'
    let output: Record<string, unknown> = { ok: false, errorCode: 'fixture_failed' }
    try {
        const raw = await Bun.stdin.text()
        if (raw.length > 16384) throw new Error('oversized_input')
        const command = commandSchema.parse(JSON.parse(raw))
        executionStage = 'context'
        context = await createFixtureContext(command)
        executionStage = 'command'
        output = {
            ok: true,
            ...(extension ? await extension(context) : await executeCoreFixture(context)),
        }
    } catch (error) {
        output = {
            ok: false,
            errorCode: safeErrorCode(error),
            executionStage,
            ...(error instanceof FixtureContextError
                ? { contextStage: error.contextStage, diagnosticCode: error.diagnosticCode }
                : {}),
        }
        process.exitCode = 1
    } finally {
        try {
            await context?.close()
        } catch {
            output = { ok: false, errorCode: 'fixture_cleanup_failed' }
            process.exitCode = 1
        }
        Object.assign(console, originalConsole)
    }
    process.stdout.write('RELIABILITY_RESULT=' + JSON.stringify(output) + '\n')
}
if (import.meta.main) await runFixture()
