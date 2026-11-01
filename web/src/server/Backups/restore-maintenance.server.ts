import '@tanstack/react-start/server-only'

import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'
import { createRestoreMaintenanceFence } from './restore-maintenance-fence.ts'
import { stopWorkersForRestoreMaintenance } from '@/server/Foundation/worker-lifecycle.server.ts'
import { readRestoreMaintenanceStatus } from './restore-maintenance-status.server.ts'

const directory = '/run/rentnerproxy/maintenance'
let lastMaintenance: ManagedBackupMaintenance | null = null
let restartingBootstrap = false
let destructivelyQuiesced = false

async function readViewerSessions() {
    const { db } = await import('@/db/index.ts')
    const rows = await db.execute(sql`
        SELECT s.token_hash AS "tokenHash", s.expires_at AS "expiresAt"
        FROM rentnerproxy.sessions s
        JOIN rentnerproxy.users u ON u.id = s.user_id
        WHERE s.expires_at > now() AND u.status = 'active' AND EXISTS (
            SELECT 1 FROM rentnerproxy.user_roles ur
            JOIN rentnerproxy.roles r ON r.id = ur.role_id
            LEFT JOIN rentnerproxy.role_permissions rp ON rp.role_id = r.id
            LEFT JOIN rentnerproxy.permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = s.user_id AND (r.key = ${SYSTEM_ROLES.OWNER} OR p.key = ${PERMISSIONS.APP_ACCESS})
        )
        LIMIT 10001
    `)
    return z
        .array(
            z.object({
                tokenHash: z.string().regex(/^[a-f0-9]{64}$/u),
                expiresAt: z.coerce.date(),
            }),
        )
        .max(10_000)
        .parse(rows)
}

async function quiesce() {
    await stopWorkersForRestoreMaintenance()
    const sessions = await readViewerSessions()
    const { closeDatabaseForRestoreMaintenance } = await import('@/db/index.ts')
    // Stop detached or timed-out work before acknowledging destructive replacement.
    await closeDatabaseForRestoreMaintenance()
    return sessions
}

async function acknowledge(id: string): Promise<void> {
    if (restartingBootstrap) return
    const temporary = directory + '/.web-quiesced-' + randomUUID() + '.json'
    try {
        const file = await open(temporary, 'wx', 0o600)
        try {
            await file.writeFile(JSON.stringify({ id, quiescedAt: Date.now() }))
            await file.sync()
        } finally {
            await file.close()
        }
        await rename(temporary, directory + '/web-quiesced.json')
    } finally {
        await unlink(temporary).catch(() => undefined)
    }
}

const fence = createRestoreMaintenanceFence({ prepare: readViewerSessions, quiesce, acknowledge })
let polling: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null

async function pollMaintenance(): Promise<void> {
    const status = await readRestoreMaintenanceStatus()
    if (status?.operation === 'restore') {
        lastMaintenance = status
        if (!fence.isFenced() && status.state !== 'succeeded' && status.phase === 'restarting')
            restartingBootstrap = true
        if (restartingBootstrap && status.state === 'succeeded') {
            fence.release()
            restartingBootstrap = false
            return
        }
        const destructivePhase = !['queued', 'validating'].includes(status.phase)
        if (
            !destructivelyQuiesced &&
            !restartingBootstrap &&
            !destructivePhase &&
            (status.state === 'failed' || status.state === 'interrupted')
        ) {
            fence.release()
            return
        }
        if (
            status.state === 'queued' ||
            status.state === 'running' ||
            status.state === 'interrupted' ||
            (status.state === 'failed' && destructivePhase)
        ) {
            let preparing: Promise<void>
            if (destructivePhase && !restartingBootstrap) {
                destructivelyQuiesced = true
                preparing = fence.enter(status.id)
            } else preparing = fence.prepare(status.id)
            void preparing.catch(() => {
                console.warn(
                    '[backups] Restore maintenance could not quiesce; replacement remains blocked',
                )
            })
        }
    } else if (!fence.isFenced()) lastMaintenance = null
}

function poll(): Promise<void> {
    polling ??= pollMaintenance().finally(() => {
        polling = null
    })
    return polling
}

export function startRestoreMaintenanceWatcher(): void {
    if (timer !== null) return
    tickMaintenance()
    timer = setInterval(tickMaintenance, 250)
    timer.unref()
    process.once('rentnerproxy:shutdown', () => {
        if (timer !== null) clearInterval(timer)
        timer = null
    })
}

function tickMaintenance(): void {
    void poll().catch(() => {
        console.warn('[backups] Restore maintenance fence unavailable')
    })
}

export async function getActiveRestoreMaintenance(): Promise<ManagedBackupMaintenance | null> {
    await poll()
    return fence.isFenced() ? lastMaintenance : null
}

export function authorizeMaintenanceSnapshot(request: Request): boolean {
    return fence.authorize(request)
}

export function isRestoreMaintenanceFenced(): boolean {
    return fence.isFenced()
}

export async function withRestoreMaintenanceFence(
    request: Request,
    next: () => Promise<Response>,
): Promise<Response> {
    // Observe a newly published root operation before admitting another request.
    try {
        await poll()
    } catch {
        return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (
        restartingBootstrap &&
        request.method === 'GET' &&
        ['/health/ready', '/health/live'].includes(new URL(request.url).pathname)
    )
        return next()
    return fence.fetch(request, next)
}
