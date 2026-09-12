// oxlint-disable no-await-in-loop -- The bounded polling helper intentionally checks progress in order.
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'

import {
    auditEvents,
    certificateDomains,
    certificateEventCursor,
    certificateEventReceipts,
    certificates,
} from '../db/schema'
import {
    startCertificateEventsSynchronization,
    stopCertificateEventsSynchronization,
    synchronizeCertificateEventsOnce,
} from '../server/Admin/CertificateManagement/certificate-events.worker'
import { getAuthDatabase } from '../server/Auth/Core/database.server'
import { getDatabaseUrl } from '../server/env.server'

const enabled = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1' && getDatabaseUrl() !== null
const integrationTest = enabled ? test : test.skip
const TOKEN = 'certificate-events-integration-token-00000000000000000000'
const CERTIFICATE_ID = '0198d98a-0000-7000-8000-000000000101'
const OPERATION_ID = '0198d98a-0000-7000-8000-000000000102'
const EVENT_ID = '0198d98a-0000-7000-8000-000000000103'
const STORE_ID = '0198d98a-0000-7000-8000-000000000104'
const CURSOR = `${STORE_ID}:1`
const DOMAIN = 'events.certificate-test.invalid'
const originalEnvironment = new Map(
    ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN'].map(
        (key) => [key, process.env[key]] as const,
    ),
)

let fetchSpy: { mockRestore(): void } | undefined
let originalCursor: string | null | undefined
let eventStatus = 200
let eventRequests = 0
let eventBarrier:
    | {
          readonly gate: Promise<void>
          readonly reached: Promise<void>
          readonly reachedResolve: () => void
          readonly release: () => void
          calls: number
      }
    | undefined

const metadata = {
    id: CERTIFICATE_ID,
    source: 'manual',
    environment: null,
    domains: [DOMAIN],
    status: 'valid',
    operation: 'idle',
    issuedAt: '2026-09-11T12:00:00Z',
    expiresAt: '2026-12-10T12:00:00Z',
    issuer: 'Certificate event integration fixture',
    fingerprint: 'sha256:' + 'a'.repeat(64),
    candidate: null,
    dnsCleanupPending: false,
    lastErrorCode: null,
    updatedAt: '2026-09-12T12:00:00Z',
}

const event = {
    id: EVENT_ID,
    operationId: OPERATION_ID,
    certificateId: CERTIFICATE_ID,
    kind: 'started',
    stage: 'creating_order',
    occurredAt: '2026-09-12T12:00:01Z',
    errorCode: null,
}

function controllerResponse(request: Request): Response {
    const url = new URL(request.url)
    if (url.pathname === '/internal/v1/certificates/events') {
        eventRequests += 1
        return Response.json(
            eventStatus === 200
                ? {
                      events: [event],
                      nextCursor: CURSOR,
                      hasMore: false,
                      resetRequired: false,
                  }
                : { error: 'controller_unavailable' },
            { status: eventStatus },
        )
    }
    if (url.pathname === '/internal/v1/certificates')
        return Response.json({ certificates: [metadata] })
    return new Response(null, { status: 404 })
}

async function readCursor(): Promise<string | null> {
    const rows = await getAuthDatabase()
        .select({ cursor: certificateEventCursor.cursor })
        .from(certificateEventCursor)
        .where(eq(certificateEventCursor.id, 1))
        .limit(1)
    return rows.at(0)?.cursor ?? null
}

async function readEventRows() {
    return getAuthDatabase()
        .select()
        .from(certificateEventReceipts)
        .where(eq(certificateEventReceipts.eventId, EVENT_ID))
}

async function readAuditRows() {
    return getAuthDatabase()
        .select()
        .from(auditEvents)
        .where(
            and(eq(auditEvents.targetId, CERTIFICATE_ID), inArray(auditEvents.action, ['started'])),
        )
}

async function cleanupFixture(): Promise<void> {
    const database = getAuthDatabase()
    await database.delete(auditEvents).where(eq(auditEvents.targetId, CERTIFICATE_ID))
    await database
        .delete(certificateEventReceipts)
        .where(inArray(certificateEventReceipts.eventId, [EVENT_ID]))
    await database
        .delete(certificateDomains)
        .where(eq(certificateDomains.certificateId, CERTIFICATE_ID))
    await database.delete(certificates).where(eq(certificates.id, CERTIFICATE_ID))
    if (originalCursor === undefined) {
        await database.delete(certificateEventCursor).where(eq(certificateEventCursor.id, 1))
    } else {
        await database
            .insert(certificateEventCursor)
            .values({ id: 1, cursor: originalCursor })
            .onConflictDoUpdate({
                target: certificateEventCursor.id,
                set: { cursor: originalCursor, updatedAt: new Date() },
            })
    }
}

async function waitForEventWorker(predicate: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
        if (await predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('Timed out waiting for the certificate event worker.')
}

beforeEach(async () => {
    if (!enabled) return
    originalCursor = await readCursor()
    eventStatus = 200
    eventRequests = 0
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:18082'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = TOKEN
    await cleanupFixture()
    await getAuthDatabase()
        .insert(certificateEventCursor)
        .values({ id: 1, cursor: null })
        .onConflictDoUpdate({
            target: certificateEventCursor.id,
            set: { cursor: null, updatedAt: new Date() },
        })
    await getAuthDatabase().insert(certificates).values({
        id: CERTIFICATE_ID,
        name: 'Certificate event integration fixture',
        source: 'manual',
        environment: null,
        status: 'pending',
        operation: 'idle',
    })
    await getAuthDatabase().insert(certificateDomains).values({
        certificateId: CERTIFICATE_ID,
        domain: DOMAIN,
    })
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit) => {
                const request = new Request(input, init)
                if (request.headers.get('authorization') !== `Bearer ${TOKEN}`)
                    return Response.json({ error: 'unauthorized' }, { status: 401 })
                if (new URL(request.url).pathname === '/internal/v1/certificates/events') {
                    const barrier = eventBarrier
                    if (barrier) {
                        barrier.calls += 1
                        if (barrier.calls === 2) barrier.reachedResolve()
                        await barrier.gate
                    }
                }
                return controllerResponse(request)
            },
            { preconnect: globalThis.fetch.preconnect },
        ),
    )
})

afterEach(async () => {
    eventBarrier = undefined
    fetchSpy?.mockRestore()
    fetchSpy = undefined
    if (enabled) await cleanupFixture()
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    originalCursor = undefined
})

describe('certificate event synchronization with PostgreSQL', () => {
    integrationTest(
        'persists metadata and audits each event once across repeated syncs',
        async () => {
            await expect(synchronizeCertificateEventsOnce()).resolves.toBe(true)
            await expect(synchronizeCertificateEventsOnce()).resolves.toBe(true)
            expect(await readCursor()).toBe(CURSOR)
            expect(await readEventRows()).toHaveLength(1)
            expect(await readAuditRows()).toHaveLength(1)
            const [row] = await getAuthDatabase()
                .select({ status: certificates.status, domains: certificateDomains.domain })
                .from(certificates)
                .innerJoin(
                    certificateDomains,
                    eq(certificateDomains.certificateId, certificates.id),
                )
                .where(eq(certificates.id, CERTIFICATE_ID))
            expect(row).toMatchObject({ status: 'valid', domains: DOMAIN })
        },
    )

    integrationTest(
        'leaves the durable snapshot unchanged when the controller is unavailable',
        async () => {
            await synchronizeCertificateEventsOnce()
            const before = {
                cursor: await readCursor(),
                receipts: await readEventRows(),
                audits: await readAuditRows(),
            }
            eventStatus = 503
            await expect(synchronizeCertificateEventsOnce()).rejects.toMatchObject({
                code: 'controller_unavailable',
            })
            expect(await readCursor()).toBe(before.cursor)
            expect(await readEventRows()).toEqual(before.receipts)
            expect(await readAuditRows()).toEqual(before.audits)
        },
    )

    integrationTest(
        'serializes concurrent snapshots through the cursor compare and swap',
        async () => {
            let release!: () => void
            let reachedResolve!: () => void
            const gate = new Promise<void>((resolve) => {
                release = resolve
            })
            const reached = new Promise<void>((resolve) => {
                reachedResolve = resolve
            })
            eventBarrier = { gate, reached, reachedResolve, release, calls: 0 }
            const concurrent = Promise.all([
                synchronizeCertificateEventsOnce(),
                synchronizeCertificateEventsOnce(),
            ])
            await reached
            release()
            const results = await concurrent
            eventBarrier = undefined
            expect(results.filter(Boolean)).toHaveLength(1)
            expect(await readCursor()).toBe(CURSOR)
            expect(await readEventRows()).toHaveLength(1)
            expect(await readAuditRows()).toHaveLength(1)
        },
    )

    integrationTest(
        'runs the background lifecycle without a browser and deduplicates after restart',
        async () => {
            startCertificateEventsSynchronization()
            try {
                await waitForEventWorker(async () => (await readEventRows()).length === 1)
            } finally {
                await stopCertificateEventsSynchronization()
            }
            expect(eventRequests).toBeGreaterThan(0)

            const requestsBeforeRestart = eventRequests
            startCertificateEventsSynchronization()
            try {
                await waitForEventWorker(async () => eventRequests > requestsBeforeRestart)
            } finally {
                await stopCertificateEventsSynchronization()
            }
            expect(await readEventRows()).toHaveLength(1)
            expect(await readAuditRows()).toHaveLength(1)
        },
    )
})
