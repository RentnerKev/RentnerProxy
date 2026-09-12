// oxlint-disable no-await-in-loop -- The controller event stream is consumed in cursor order.
// oxlint-disable-next-line import/no-unassigned-import -- Keeps the synchronization worker server-only.
import '@tanstack/react-start/server-only'

import { lt, sql } from 'drizzle-orm'

import { certificateEventCursor, certificateEventReceipts } from '../../../db/schema'
import type { CertificateEventMetadata } from '../../../shared/Types/certificates.types'
import { appendAuditEventsInTransaction } from '../../Audit/audit.service'
import {
    getControllerCertificateEvents,
    getControllerCertificates,
    type ControllerCertificateMetadata,
} from '../../Foundation/certificates.server'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { persistControllerCertificatesMetadataInTransaction } from './certificates.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'

const CERTIFICATE_EVENT_SYNC_LOCK_ID = 7_421_910
const CERTIFICATE_EVENT_PAGE_LIMIT = 100
const CERTIFICATE_EVENT_MAX_PAGES_PER_TICK = 5
const CERTIFICATE_EVENT_POLL_INTERVAL_MS = 15_000
const CERTIFICATE_EVENT_INITIAL_RETRY_DELAY_MS = 1_000
const CERTIFICATE_EVENT_MAX_RETRY_DELAY_MS = 60_000
const CERTIFICATE_EVENT_RECEIPT_RETENTION_DAYS = 180
const CERTIFICATE_EVENT_RECEIPT_MAX_ROWS = 100_000
const MAX_EVENT_SEQUENCE = 18_446_744_073_709_551_615n
const CERTIFICATE_EVENT_CURSOR_PATTERN =
    /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(\d{1,20})$/u

type Cursor = string | null

interface FetchedEvents {
    readonly expectedCursor: Cursor
    readonly nextCursor: Cursor
    readonly resetRequired: boolean
    readonly events: readonly CertificateEventMetadata[]
    readonly metadata: readonly ControllerCertificateMetadata[]
}

function parseCursor(
    cursor: Cursor,
): { readonly storeId: string; readonly sequence: bigint } | null {
    if (cursor === null) return null
    const match = CERTIFICATE_EVENT_CURSOR_PATTERN.exec(cursor)
    if (!match) return null
    const storeId = match[1]
    const sequenceText = match[2]
    if (storeId === undefined || sequenceText === undefined) return null
    try {
        const sequence = BigInt(sequenceText)
        return sequence <= MAX_EVENT_SEQUENCE ? { storeId, sequence } : null
    } catch {
        return null
    }
}

function cursorIsAtLeast(candidate: Cursor, current: Cursor): boolean {
    if (candidate === current) return true
    if (candidate === null) return false
    if (current === null) return true
    const candidateParts = parseCursor(candidate)
    const currentParts = parseCursor(current)
    if (!candidateParts || !currentParts) return false
    return (
        candidateParts.storeId === currentParts.storeId &&
        candidateParts.sequence >= currentParts.sequence
    )
}

async function readCursor(): Promise<Cursor> {
    const rows = await getAuthDatabase()
        .select({ cursor: certificateEventCursor.cursor })
        .from(certificateEventCursor)
        .where(sql`${certificateEventCursor.id} = 1`)
        .limit(1)
    const cursor = rows.at(0)?.cursor ?? null
    return cursor === null || parseCursor(cursor) !== null ? cursor : null
}

async function fetchEventsAndMetadata(expectedCursor: Cursor): Promise<FetchedEvents> {
    let after = expectedCursor
    let nextCursor = expectedCursor
    let resetRequired = false
    const events: CertificateEventMetadata[] = []

    for (let pageNumber = 0; pageNumber < CERTIFICATE_EVENT_MAX_PAGES_PER_TICK; pageNumber += 1) {
        const page = await getControllerCertificateEvents(after, CERTIFICATE_EVENT_PAGE_LIMIT)
        resetRequired ||= page.resetRequired
        events.push(...page.events)
        nextCursor = page.nextCursor
        if (!page.hasMore) break
        after = page.nextCursor
    }

    // The list and event endpoints are both authoritative controller reads. Fetch them before
    // opening the transaction so a 503 leaves every local table unchanged.
    const metadata = await getControllerCertificates()
    return { expectedCursor, nextCursor, resetRequired, events, metadata }
}

function eventResult(event: CertificateEventMetadata): 'success' | 'failure' {
    return (event.kind === 'failed' || event.kind === 'retry_scheduled') && event.errorCode !== null
        ? 'failure'
        : 'success'
}

async function pruneEventReceiptsInTransaction(transaction: AuthTransaction): Promise<void> {
    const cutoff = new Date(
        Date.now() - CERTIFICATE_EVENT_RECEIPT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    )
    await transaction
        .delete(certificateEventReceipts)
        .where(lt(certificateEventReceipts.receivedAt, cutoff))
    await transaction.execute(sql`
        delete from "rentnerproxy"."certificate_event_receipts"
        where "event_id" in (
            select "event_id" from "rentnerproxy"."certificate_event_receipts"
            order by "received_at" desc, "event_id" desc
            offset ${CERTIFICATE_EVENT_RECEIPT_MAX_ROWS}
        )
    `)
}

async function persistFetchedBatch(batch: FetchedEvents): Promise<boolean> {
    return getAuthDatabase().transaction(async (transaction) => {
        await transaction.execute(
            sql`select pg_advisory_xact_lock(${CERTIFICATE_EVENT_SYNC_LOCK_ID})`,
        )
        await transaction
            .insert(certificateEventCursor)
            .values({ id: 1, cursor: batch.expectedCursor })
            .onConflictDoNothing({ target: certificateEventCursor.id })
        const [cursorRow] = await transaction
            .select({ cursor: certificateEventCursor.cursor })
            .from(certificateEventCursor)
            .where(sql`${certificateEventCursor.id} = 1`)
            .limit(1)
            .for('update')
        const currentCursor = cursorRow?.cursor ?? null
        // Another web instance may have committed a newer page while this instance was reading
        // the controller. Discard the whole stale batch, including metadata, so it cannot regress
        // a current operation or move the durable cursor backwards.
        if (currentCursor !== batch.expectedCursor) return false

        await lockProxyRuntimeSettings(transaction)
        // A background snapshot must not mark a certificate created after the fetch as missing.
        // The interactive authoritative listing retains the existing missing-row reconciliation.
        await persistControllerCertificatesMetadataInTransaction(transaction, batch.metadata, false)
        const newEvents: CertificateEventMetadata[] = []
        for (const event of batch.events) {
            const [receipt] = await transaction
                .insert(certificateEventReceipts)
                .values({
                    eventId: event.id,
                    operationId: event.operationId,
                    certificateId: event.certificateId,
                    kind: event.kind,
                    stage: event.stage,
                    occurredAt: new Date(event.occurredAt),
                    errorCode: event.errorCode,
                })
                .onConflictDoNothing({ target: certificateEventReceipts.eventId })
                .returning({ eventId: certificateEventReceipts.eventId })
            if (receipt) newEvents.push(event)
        }
        await appendAuditEventsInTransaction(
            transaction,
            newEvents.map((event) => ({
                actorUserId: null,
                actorKind: 'system',
                action: event.kind,
                resource: 'certificate',
                targetId: event.certificateId,
                result: eventResult(event),
                metadata: {
                    operationId: event.operationId,
                    eventId: event.id,
                    certificateStage: event.stage,
                    occurredAt: event.occurredAt,
                    ...(event.errorCode === null ? {} : { certificateErrorCode: event.errorCode }),
                },
            })),
        )

        const candidateCursor = batch.nextCursor
        if (
            candidateCursor !== currentCursor &&
            (batch.resetRequired || cursorIsAtLeast(candidateCursor, currentCursor))
        ) {
            await transaction
                .update(certificateEventCursor)
                .set({ cursor: candidateCursor, updatedAt: new Date() })
                .where(sql`${certificateEventCursor.id} = 1`)
        }
        await pruneEventReceiptsInTransaction(transaction)
        return true
    })
}

export async function synchronizeCertificateEventsOnce(): Promise<boolean> {
    const cursor = await readCursor()
    return persistFetchedBatch(await fetchEventsAndMetadata(cursor))
}

let stopped = false
let worker: Promise<void> | null = null
let wakeResolver: (() => void) | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

function wake(): void {
    const resolve = wakeResolver
    wakeResolver = null
    resolve?.()
}

async function waitForWakeOrDelay(milliseconds: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const wakePromise = new Promise<void>((resolve) => {
        wakeResolver = resolve
    })
    const timerPromise = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds)
        retryTimer = timer
        timer.unref?.()
    })
    await Promise.race([wakePromise, timerPromise])
    if (timer !== undefined) clearTimeout(timer)
    if (retryTimer === timer) retryTimer = null
    if (wakeResolver !== null) wakeResolver = null
}

async function runWorker(): Promise<void> {
    let retryDelay = CERTIFICATE_EVENT_INITIAL_RETRY_DELAY_MS
    // oxlint-disable-next-line no-unmodified-loop-condition -- stopCertificateEventsSynchronization changes this lifecycle flag.
    while (!stopped) {
        try {
            await synchronizeCertificateEventsOnce()
            if (stopped) break
            retryDelay = CERTIFICATE_EVENT_INITIAL_RETRY_DELAY_MS
            await waitForWakeOrDelay(CERTIFICATE_EVENT_POLL_INTERVAL_MS)
        } catch {
            if (stopped) break
            console.warn('[certificates] event synchronization unavailable')
            await waitForWakeOrDelay(retryDelay)
            retryDelay = Math.min(retryDelay * 2, CERTIFICATE_EVENT_MAX_RETRY_DELAY_MS)
        }
    }
}

export function startCertificateEventsSynchronization(): void {
    if (worker !== null) return
    stopped = false
    worker = runWorker().finally(() => {
        worker = null
    })
}

export async function stopCertificateEventsSynchronization(): Promise<void> {
    stopped = true
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    wake()
    if (worker !== null) await worker
}
