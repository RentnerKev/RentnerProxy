// oxlint-disable no-await-in-loop -- Each workflow owns a distinct certificate and authenticated transaction.
import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, expect, mock, spyOn } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { auditEvents, certificateDomains, certificates } from '@/db/schema.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'
import * as controller from '@/server/Controller/certificates.server.ts'
import * as snapshot from '@/server/Admin/CertificateManagement/certificate-metadata-snapshot.server.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import {
    actOnManualDnsService,
    cancelDelegatedCertificateService,
    getAssignableCertificatesService,
    getCertificatesService,
    searchCertificatesService,
} from '@/server/Admin/CertificateManagement/certificates.service.ts'
import { requireUserService } from '@/server/Auth/Access/authorization.service.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
} from '@/tests/Helpers/backendCoverageFixture.ts'
const ownedCertificates: string[] = []
const future = new Date(Date.now() + 86400000).toISOString()
function operation(
    kind: 'issue' | 'renew' = 'issue',
    mode: 'manual' | 'delegated' = 'manual',
): NonNullable<ControllerCertificateMetadata['currentOperation']> {
    const now = new Date().toISOString()
    return {
        id: Bun.randomUUIDv7(),
        kind,
        dnsMode: mode,
        stage: mode === 'manual' ? 'awaiting_dns' : 'preparing_challenge',
        startedAt: now,
        updatedAt: now,
        ...(mode === 'manual'
            ? {
                  manualDns: {
                      challengeSetId: Bun.randomUUIDv7(),
                      status: 'awaiting_input' as const,
                      expiresAt: future,
                      records: [
                          {
                              identifier: 'example.com',
                              owner: '_acme-challenge.example.com',
                              value: 'a'.repeat(43),
                              expiresAt: future,
                          },
                      ],
                      lastCheckedAt: null,
                      lastErrorCode: null,
                  },
              }
            : {}),
    }
}
function metadata(
    id: string,
    currentOperation: NonNullable<ControllerCertificateMetadata['currentOperation']>,
): ControllerCertificateMetadata {
    return {
        id,
        source: 'acme',
        environment: 'staging',
        domains: ['example.com'],
        status: 'pending',
        operation: currentOperation.kind === 'renew' ? 'renewing' : 'issuing',
        currentOperation,
        challengeType: 'dns-01',
        dnsMode: currentOperation.dnsMode,
        issuedAt: null,
        expiresAt: null,
        issuer: null,
        fingerprint: null,
        lastErrorCode: null,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
    }
}
async function seed(currentOperation = operation()) {
    const id = randomUUID()
    await database.insert(certificates).values({
        id,
        name: `coverage-certificate-${id}`,
        source: 'acme',
        environment: 'staging',
        status: 'pending',
        operation: currentOperation.kind === 'renew' ? 'renewing' : 'issuing',
        currentOperation,
        challengeType: 'dns-01',
    })
    await database.insert(certificateDomains).values({ certificateId: id, domain: 'example.com' })
    ownedCertificates.push(id)
    return { id, currentOperation }
}
async function row(id: string) {
    return (await database.select().from(certificates).where(eq(certificates.id, id)))[0]
}
beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
afterEach(async () => {
    mock.restore()
    if (!backendCoverageEnabled) return
    if (ownedCertificates.length) {
        await database.delete(auditEvents).where(inArray(auditEvents.targetId, ownedCertificates))
        await database
            .delete(certificates)
            .where(inArray(certificates.id, ownedCertificates.splice(0)))
    }
    await cleanupBackendCoverage()
})

integrationTest(
    'manual DNS continue and cancel bind the operation and challenge ids and require the matching issue or renew grant',
    async () => {
        const forward = spyOn(controller, 'actOnControllerManualDns')
        for (const kind of ['issue', 'renew'] as const) {
            const actor = await createBackendActor([
                kind === 'issue' ? PERMISSIONS.CERTIFICATES_ISSUE : PERMISSIONS.CERTIFICATES_RENEW,
            ])
            for (const action of ['continue', 'cancel'] as const) {
                const target = await seed(operation(kind))
                const manual = target.currentOperation.manualDns
                if (!manual) throw new Error('Missing manual fixture challenge')
                const next = metadata(target.id, {
                    ...target.currentOperation,
                    stage: action === 'continue' ? 'checking_dns' : 'cancelled',
                    manualDns: {
                        ...manual,
                        status: action === 'continue' ? 'checking_dns' : 'cancelled',
                    },
                })
                forward.mockResolvedValueOnce(next)
                expect(
                    await asBackendActor(actor, () =>
                        actOnManualDnsService(
                            {
                                certificateId: target.id.toUpperCase(),
                                operationId: target.currentOperation.id.toUpperCase(),
                                challengeSetId: manual.challengeSetId.toUpperCase(),
                            },
                            action,
                        ),
                    ),
                ).toBe(target.id)
                expect(forward).toHaveBeenLastCalledWith(target.id, action, {
                    operationId: target.currentOperation.id,
                    challengeSetId: manual.challengeSetId,
                })
                expect((await row(target.id))?.currentOperation?.stage).toBe(
                    next.currentOperation?.stage,
                )
                expect(
                    await database
                        .select()
                        .from(auditEvents)
                        .where(eq(auditEvents.targetId, target.id)),
                ).toMatchObject([{ action: 'update', result: 'success', actorUserId: actor }])
            }
        }
    },
)

integrationTest(
    'stale manual actions and transport failures cannot mutate persisted operation state',
    async () => {
        const actor = await createBackendActor()
        const forward = spyOn(controller, 'actOnControllerManualDns')
        for (const mutation of [
            'operation-id',
            'challenge-id',
            'phase',
            'source',
            'kind',
            'mode',
            'missing',
        ] as const) {
            const target = await seed()
            const manual = target.currentOperation.manualDns
            if (!manual) throw new Error('Missing manual fixture challenge')
            const input = {
                certificateId: target.id,
                operationId: target.currentOperation.id,
                challengeSetId: manual.challengeSetId,
            }
            if (mutation === 'operation-id') input.operationId = Bun.randomUUIDv7()
            if (mutation === 'challenge-id') input.challengeSetId = Bun.randomUUIDv7()
            if (mutation === 'phase')
                await database
                    .update(certificates)
                    .set({
                        currentOperation: {
                            ...target.currentOperation,
                            manualDns: { ...manual, status: 'checking_dns' },
                        },
                    })
                    .where(eq(certificates.id, target.id))
            if (mutation === 'source')
                await database
                    .update(certificates)
                    .set({ source: 'manual', environment: null })
                    .where(eq(certificates.id, target.id))
            if (mutation === 'kind')
                await database
                    .update(certificates)
                    .set({ currentOperation: { ...target.currentOperation, kind: 'import' } })
                    .where(eq(certificates.id, target.id))
            if (mutation === 'mode')
                await database
                    .update(certificates)
                    .set({ currentOperation: { ...target.currentOperation, dnsMode: 'provider' } })
                    .where(eq(certificates.id, target.id))
            if (mutation === 'missing')
                await database
                    .update(certificates)
                    .set({ currentOperation: null })
                    .where(eq(certificates.id, target.id))
            const before = await row(target.id)
            await expect(
                asBackendActor(actor, () => actOnManualDnsService(input, 'continue')),
            ).rejects.toMatchObject({ code: 'operation_in_progress' })
            expect(await row(target.id)).toEqual(before)
        }
        expect(forward).not.toHaveBeenCalled()
        const target = await seed()
        const before = await row(target.id)
        forward.mockRejectedValueOnce(new CertificateDomainError('acme_failed'))
        await expect(
            asBackendActor(actor, () =>
                actOnManualDnsService(
                    {
                        certificateId: target.id,
                        operationId: target.currentOperation.id,
                        challengeSetId: target.currentOperation.manualDns!.challengeSetId,
                    },
                    'continue',
                ),
            ),
        ).rejects.toMatchObject({ code: 'acme_failed' })
        expect(await row(target.id)).toEqual(before)
    },
)

integrationTest(
    'manual operations recheck scoped grants and reject malformed requests before contacting the controller',
    async () => {
        const viewer = await createBackendActor([PERMISSIONS.CERTIFICATES_VIEW])
        const renewer = await createBackendActor([PERMISSIONS.CERTIFICATES_RENEW])
        const target = await seed()
        const forward = spyOn(controller, 'actOnControllerManualDns')
        const input = {
            certificateId: target.id,
            operationId: target.currentOperation.id,
            challengeSetId: target.currentOperation.manualDns!.challengeSetId,
        }
        await expect(
            asBackendActor(viewer, () => actOnManualDnsService(input, 'continue')),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        await expect(
            asBackendActor(renewer, () => actOnManualDnsService(input, 'continue')),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        await expect(
            asBackendActor(renewer, () =>
                actOnManualDnsService({ ...input, operationId: 'invalid' }, 'continue'),
            ),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(forward).not.toHaveBeenCalled()
    },
)

integrationTest(
    'delegated cancellation validates active generations and rejects mismatched controller operation kinds atomically',
    async () => {
        const actor = await createBackendActor()
        const cancel = spyOn(controller, 'cancelControllerDelegatedCertificate')
        for (const kind of ['issue', 'renew'] as const) {
            const target = await seed(operation(kind, 'delegated'))
            const before = await row(target.id)
            cancel.mockResolvedValueOnce(
                metadata(target.id, {
                    ...target.currentOperation,
                    kind: kind === 'issue' ? 'renew' : 'issue',
                    stage: 'cancelled',
                }),
            )
            await expect(
                asBackendActor(actor, () =>
                    cancelDelegatedCertificateService({
                        certificateId: target.id,
                        operationId: target.currentOperation.id,
                    }),
                ),
            ).rejects.toMatchObject({ code: 'controller_unavailable' })
            expect(await row(target.id)).toEqual(before)
            cancel.mockResolvedValueOnce(
                metadata(target.id, { ...target.currentOperation, stage: 'cancelled' }),
            )
            expect(
                await asBackendActor(actor, () =>
                    cancelDelegatedCertificateService({
                        certificateId: target.id,
                        operationId: target.currentOperation.id,
                    }),
                ),
            ).toBe(target.id)
            expect(cancel).toHaveBeenLastCalledWith(target.id, target.currentOperation.id)
            expect((await row(target.id))?.currentOperation?.stage).toBe('cancelled')
        }
        const target = await seed(operation('issue', 'delegated'))
        const calls = cancel.mock.calls.length
        await expect(
            asBackendActor(actor, () =>
                cancelDelegatedCertificateService({
                    certificateId: target.id,
                    operationId: Bun.randomUUIDv7(),
                }),
            ),
        ).rejects.toMatchObject({ code: 'operation_in_progress' })
        await database
            .update(certificates)
            .set({ currentOperation: { ...target.currentOperation, stage: 'finalizing' } })
            .where(eq(certificates.id, target.id))
        await expect(
            asBackendActor(actor, () =>
                cancelDelegatedCertificateService({
                    certificateId: target.id,
                    operationId: target.currentOperation.id,
                }),
            ),
        ).rejects.toMatchObject({ code: 'operation_in_progress' })
        expect(cancel.mock.calls).toHaveLength(calls)
    },
)

integrationTest(
    'certificate search uses actual request identity and literal SQL search semantics',
    async () => {
        const actorId = await createBackendActor([PERMISSIONS.CERTIFICATES_VIEW])
        const otherId = await createBackendActor([PERMISSIONS.CERTIFICATES_VIEW])
        const actor = await asBackendActor(actorId, requireUserService)
        const target = await seed()
        await database
            .update(certificates)
            .set({ name: 'Coverage 100%_literal' })
            .where(eq(certificates.id, target.id))
        await database
            .insert(certificateDomains)
            .values({ certificateId: target.id, domain: 'a.example.com' })
        const otherTarget = await seed()
        await database
            .update(certificateDomains)
            .set({ domain: 'other.example.com' })
            .where(eq(certificateDomains.certificateId, otherTarget.id))
        expect(
            await asBackendActor(actorId, () =>
                searchCertificatesService(actor, { query: '100%_' }),
            ),
        ).toEqual([{ id: target.id, label: 'Coverage 100%_literal', detail: 'a.example.com' }])
        expect(
            await asBackendActor(actorId, () =>
                searchCertificatesService(actor, { query: 'irrelevant', id: otherTarget.id }),
            ),
        ).toMatchObject([{ id: otherTarget.id, detail: 'other.example.com' }])
        await expect(
            asBackendActor(otherId, () => searchCertificatesService(actor, { query: 'Coverage' })),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        await expect(
            asBackendActor(actorId, () =>
                searchCertificatesService({ ...actor, permissions: [] }, { query: 'Coverage' }),
            ),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        await expect(
            asBackendActor(actorId, () => searchCertificatesService(actor, { query: '' })),
        ).rejects.toMatchObject({ code: 'invalid_input' })
    },
)

integrationTest(
    'certificate summaries expose dated operation and candidate metadata with each supported host assignment permission',
    async () => {
        const actor = await createBackendActor([PERMISSIONS.CERTIFICATES_VIEW])
        const target = await seed(operation('renew'))
        const incoming: ControllerCertificateMetadata = {
            ...metadata(target.id, target.currentOperation),
            status: 'valid',
            issuedAt: new Date(Date.now() - 86400000).toISOString(),
            expiresAt: future,
            fingerprint: 'sha256:' + 'a'.repeat(64),
            candidate: {
                fingerprint: 'sha256:' + 'b'.repeat(64),
                issuedAt: new Date(Date.now() - 86400000).toISOString(),
                expiresAt: future,
                lastErrorCode: 'runtime_apply_failed',
                nextAttemptAt: future,
            },
        }
        spyOn(snapshot, 'getCertificateMetadataSnapshot').mockResolvedValue({
            metadata: [incoming],
            validBeforeRead: [],
        })
        const summaries = await asBackendActor(actor, getCertificatesService)
        const summary = summaries.find((entry) => entry.id === target.id)
        expect(summary?.currentOperation?.startedAt).toBeInstanceOf(Date)
        expect(summary?.candidate?.expiresAt).toBeInstanceOf(Date)
        expect(summary?.dnsMode).toBe('manual')
        for (const permission of [
            PERMISSIONS.PROXY_HOSTS_UPDATE,
            PERMISSIONS.PROXY_HOSTS_CREATE,
            PERMISSIONS.REDIRECT_HOSTS_UPDATE,
            PERMISSIONS.REDIRECT_HOSTS_CREATE,
        ]) {
            const assigner = await createBackendActor([permission])
            expect(
                (await asBackendActor(assigner, getAssignableCertificatesService)).find(
                    (entry) => entry.id === target.id,
                )?.id,
            ).toBe(target.id)
        }
        await expect(asBackendActor(actor, getAssignableCertificatesService)).rejects.toMatchObject(
            { code: 'permission_denied' },
        )
    },
)
