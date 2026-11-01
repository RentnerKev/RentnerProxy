import { createHash } from 'node:crypto'

import { SESSION_COOKIE_NAME, OPAQUE_TOKEN_PATTERN } from '@/config/auth.config.ts'
import { LIVE_SNAPSHOT_PATH } from '@/config/realtime.config.ts'

export function createRestoreMaintenanceFence(dependencies: {
    prepare?: () => Promise<ReadonlyArray<{ tokenHash: string; expiresAt: Date }>>
    quiesce: () => Promise<ReadonlyArray<{ tokenHash: string; expiresAt: Date }>>
    acknowledge: (id: string) => Promise<void>
    now?: () => number
}) {
    const now = dependencies.now ?? Date.now
    const pending = new Set<Promise<unknown>>()
    let operationId: string | null = null
    let viewers = new Map<string, number>()
    let validUntil = 0
    let entering: Promise<void> | null = null
    let preparing: Promise<void> | null = null

    function cacheSessions(
        id: string,
        sessions: ReadonlyArray<{ tokenHash: string; expiresAt: Date }>,
    ): void {
        if (sessions.length > 10_000) throw new Error('Too many maintenance sessions')
        if (operationId !== id) return
        validUntil = now() + 60 * 60 * 1_000
        viewers = new Map(
            sessions.map((session) => [session.tokenHash, session.expiresAt.getTime()]),
        )
    }

    function prepare(id: string): Promise<void> {
        if (operationId !== null && operationId !== id)
            return Promise.reject(new Error('Restore maintenance already entered'))
        operationId = id
        preparing ??= (async () => {
            await Promise.allSettled(pending)
            cacheSessions(id, (await dependencies.prepare?.()) ?? [])
        })()
        return preparing
    }

    function enter(id: string): Promise<void> {
        if (operationId !== null && operationId !== id)
            return Promise.reject(new Error('Restore maintenance already entered'))
        operationId = id
        entering ??= (async () => {
            if (preparing) await preparing
            await Promise.allSettled(pending)
            const sessions = await dependencies.quiesce()
            cacheSessions(id, sessions)
            if (operationId !== id) return
            await dependencies.acknowledge(id)
        })()
        return entering
    }

    function authorize(request: Request): boolean {
        if (operationId === null || now() >= validUntil) return false
        const cookies = (request.headers.get('cookie') ?? '').split(';')
        const tokens = cookies
            .map((cookie) => cookie.trim())
            .filter((cookie) => cookie.startsWith(SESSION_COOKIE_NAME + '='))
        if (tokens.length !== 1) return false
        const token = tokens[0]?.slice(SESSION_COOKIE_NAME.length + 1) ?? ''
        if (!OPAQUE_TOKEN_PATTERN.test(token)) return false
        const expiresAt = viewers.get(createHash('sha256').update(token).digest('hex'))
        return expiresAt !== undefined && expiresAt > now()
    }

    async function fetch(request: Request, next: () => Promise<Response>): Promise<Response> {
        if (operationId !== null) {
            if (request.method === 'GET' && new URL(request.url).pathname === LIVE_SNAPSHOT_PATH)
                return next()
            return new Response('Restore maintenance in progress', {
                status: 503,
                headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
            })
        }
        const running = next()
        pending.add(running)
        try {
            return await running
        } finally {
            pending.delete(running)
        }
    }

    function release(): void {
        operationId = null
        viewers.clear()
        validUntil = 0
        entering = null
        preparing = null
    }

    return { prepare, enter, authorize, fetch, release, isFenced: () => operationId !== null }
}
