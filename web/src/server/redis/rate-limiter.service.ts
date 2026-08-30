import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'

import { getRedisClient } from './client.server'
import type { RedisCommandClient } from './Types/redis.types'

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`
const RATE_LIMIT_KEY_PREFIX = 'rentnerproxy:auth-rate-limit'
const TEN_MINUTES_MS = 10 * 60 * 1_000
const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000
const ONE_HOUR_MS = 60 * 60 * 1_000
const UNKNOWN_CLIENT_IP = 'unknown'
const RATE_LIMIT_SCOPE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const USER_ID_SCHEMA = z.uuid()

export type AuthRateLimitAction = 'invite' | 'login' | 'reset' | 'setup'
export type AuthRateLimitDimension = 'email' | 'ip'

export interface RateLimitPolicy {
    readonly limit: number
    readonly scope: string
    readonly windowMs: number
}

export interface RateLimitResult {
    readonly count: number
    readonly limit: number
    readonly remaining: number
    readonly ttlMs: number
}

export interface RateLimitRequest extends RateLimitPolicy {
    readonly identifier: string
}

export interface RateLimitDependencies {
    readonly getClient: () => RedisCommandClient | null
}

export interface AuthRateLimitRequest {
    readonly action: AuthRateLimitAction
    readonly email: string
    readonly request: Request
}

export interface AuthRateLimitResult {
    readonly email: RateLimitResult
    readonly ip: RateLimitResult
}

export interface LoginMfaRateLimitRequest {
    readonly request: Request
    readonly userId: string
}

export interface LoginMfaRateLimitResult {
    readonly ip: RateLimitResult
    readonly user: RateLimitResult
}

export interface InviteRateLimitRequest {
    readonly actorUserId: string
    readonly email: string
}

export interface InviteRateLimitResult {
    readonly actor: RateLimitResult
    readonly email: RateLimitResult
}

export interface AuthRateLimitDependencies extends RateLimitDependencies {
    readonly resolveClientIp: (request: Request) => string
    readonly warn: (reason: string) => void
}

export const AUTH_RATE_LIMITS = {
    login: {
        ip: { limit: 20, scope: 'login-ip', windowMs: TEN_MINUTES_MS },
        email: { limit: 8, scope: 'login-email', windowMs: TEN_MINUTES_MS },
    },
    setup: {
        ip: { limit: 10, scope: 'setup-ip', windowMs: TEN_MINUTES_MS },
        email: { limit: 5, scope: 'setup-email', windowMs: TEN_MINUTES_MS },
    },
    reset: {
        ip: { limit: 10, scope: 'reset-ip', windowMs: TEN_MINUTES_MS },
        email: { limit: 5, scope: 'reset-email', windowMs: TEN_MINUTES_MS },
    },
    invite: {
        ip: { limit: 20, scope: 'invite-ip', windowMs: TEN_MINUTES_MS },
        email: { limit: 8, scope: 'invite-email', windowMs: TEN_MINUTES_MS },
    },
} as const satisfies Record<AuthRateLimitAction, Record<AuthRateLimitDimension, RateLimitPolicy>>

export const LOGIN_MFA_USER_RATE_LIMIT = {
    limit: 8,
    scope: 'login-user',
    windowMs: TEN_MINUTES_MS,
} as const satisfies RateLimitPolicy

export const SENSITIVE_ACTION_RATE_LIMITS = {
    passwordChange: {
        limit: 10,
        scope: 'password-change-user',
        windowMs: FIFTEEN_MINUTES_MS,
    },
    invite: {
        actor: { limit: 20, scope: 'invite-actor', windowMs: FIFTEEN_MINUTES_MS },
        email: { limit: 5, scope: 'invite-target-email', windowMs: ONE_HOUR_MS },
    },
} as const satisfies Readonly<{
    passwordChange: RateLimitPolicy
    invite: Readonly<{ actor: RateLimitPolicy; email: RateLimitPolicy }>
}>

export class RateLimitError extends Error {
    readonly code = 'RATE_LIMITED'

    constructor(
        readonly count: number,
        readonly limit: number,
        readonly retryAfterMs: number,
        readonly scope: string,
    ) {
        super('Too many requests')
        this.name = 'RateLimitError'
    }
}

export type RateLimitUnavailableReason =
    | 'invalid_configuration'
    | 'invalid_policy'
    | 'invalid_response'
    | 'request_failed'

export class RateLimitUnavailableError extends Error {
    readonly code = 'RATE_LIMIT_UNAVAILABLE'

    constructor(readonly reason: RateLimitUnavailableReason) {
        super('Rate limiting is unavailable')
        this.name = 'RateLimitUnavailableError'
    }
}

const defaultDependencies: RateLimitDependencies = {
    getClient: getRedisClient,
}

export function hashRateLimitIdentifier(identifier: string): string {
    return createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex')
}

export function createRateLimitKey(scope: string, identifier: string): string {
    if (!RATE_LIMIT_SCOPE_PATTERN.test(scope) || !identifier.trim()) {
        throw new RateLimitUnavailableError('invalid_policy')
    }

    return `${RATE_LIMIT_KEY_PREFIX}:${scope}:${hashRateLimitIdentifier(identifier)}`
}

// Database user IDs are non-secret UUIDs, not credentials or password hashes.
export function createUserRateLimitKey(scope: string, userId: string): string {
    const normalizedUserId = userId.trim().toLowerCase()
    const parsedUserId = USER_ID_SCHEMA.safeParse(normalizedUserId)

    if (!RATE_LIMIT_SCOPE_PATTERN.test(scope) || !parsedUserId.success) {
        throw new RateLimitUnavailableError('invalid_policy')
    }

    return `${RATE_LIMIT_KEY_PREFIX}:${scope}:${parsedUserId.data}`
}

function parseRateLimitResponse(value: unknown): Readonly<{ count: number; ttlMs: number }> | null {
    if (!Array.isArray(value) || value.length !== 2) {
        return null
    }

    const [count, ttlMs] = value

    if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        typeof ttlMs !== 'number' ||
        !Number.isSafeInteger(ttlMs) ||
        ttlMs < 1
    ) {
        return null
    }

    return { count, ttlMs }
}

async function consumeRateLimitKey(
    request: RateLimitPolicy,
    key: string,
    overrides: Partial<RateLimitDependencies>,
): Promise<RateLimitResult> {
    if (
        !Number.isSafeInteger(request.limit) ||
        request.limit < 1 ||
        !Number.isSafeInteger(request.windowMs) ||
        request.windowMs < 1
    ) {
        throw new RateLimitUnavailableError('invalid_policy')
    }

    const dependencies = { ...defaultDependencies, ...overrides }
    let client: RedisCommandClient | null

    try {
        client = dependencies.getClient()
    } catch {
        throw new RateLimitUnavailableError('invalid_configuration')
    }

    if (!client) {
        throw new RateLimitUnavailableError('invalid_configuration')
    }

    let response: unknown

    try {
        response = await client.send('EVAL', [
            FIXED_WINDOW_SCRIPT,
            '1',
            key,
            String(request.windowMs),
        ])
    } catch {
        throw new RateLimitUnavailableError('request_failed')
    }

    const parsed = parseRateLimitResponse(response)

    if (!parsed) {
        throw new RateLimitUnavailableError('invalid_response')
    }

    if (parsed.count > request.limit) {
        throw new RateLimitError(parsed.count, request.limit, parsed.ttlMs, request.scope)
    }

    return {
        count: parsed.count,
        limit: request.limit,
        remaining: request.limit - parsed.count,
        ttlMs: parsed.ttlMs,
    }
}

export async function consumeRateLimit(
    request: RateLimitRequest,
    overrides: Partial<RateLimitDependencies> = {},
): Promise<RateLimitResult> {
    return consumeRateLimitKey(
        request,
        createRateLimitKey(request.scope, request.identifier),
        overrides,
    )
}

export function getClientIp(request: Request): string {
    // A web Request has no peer socket address. Forwarded headers remain untrusted until the
    // deployment defines a trusted-proxy boundary, so forged X-Forwarded-For/X-Real-IP values
    // are intentionally ignored.
    void request
    return UNKNOWN_CLIENT_IP
}

const defaultAuthDependencies: AuthRateLimitDependencies = {
    getClient: getRedisClient,
    resolveClientIp: getClientIp,
    warn: (reason) => console.warn(`[auth-rate-limit] ${reason}`),
}

function resolveRateLimitClientIp(
    request: Request,
    dependencies: AuthRateLimitDependencies,
): string {
    let clientIp = UNKNOWN_CLIENT_IP

    try {
        const resolvedClientIp = dependencies.resolveClientIp(request).trim()

        if (isIP(resolvedClientIp)) {
            clientIp = resolvedClientIp
        }
    } catch {
        // A missing peer address must not bypass the account limit or make forwarded headers
        // implicitly trusted. The shared unknown-IP bucket is the conservative fallback.
    }

    return clientIp
}

export async function enforceAuthRateLimit(
    request: AuthRateLimitRequest,
    overrides: Partial<AuthRateLimitDependencies> = {},
): Promise<AuthRateLimitResult> {
    const dependencies = { ...defaultAuthDependencies, ...overrides }
    const clientIp = resolveRateLimitClientIp(request.request, dependencies)

    if (clientIp === UNKNOWN_CLIENT_IP) {
        dependencies.warn('client IP unavailable; applying unknown-IP and email limits')
    }

    const policies = AUTH_RATE_LIMITS[request.action]
    const rateLimitDependencies: RateLimitDependencies = {
        getClient: dependencies.getClient,
    }
    const [ip, email] = await Promise.all([
        consumeRateLimit({ ...policies.ip, identifier: clientIp }, rateLimitDependencies),
        consumeRateLimit({ ...policies.email, identifier: request.email }, rateLimitDependencies),
    ])

    return { email, ip }
}

export async function enforceLoginMfaRateLimit(
    request: LoginMfaRateLimitRequest,
    overrides: Partial<AuthRateLimitDependencies> = {},
): Promise<LoginMfaRateLimitResult> {
    const userKey = createUserRateLimitKey(LOGIN_MFA_USER_RATE_LIMIT.scope, request.userId)
    const dependencies = { ...defaultAuthDependencies, ...overrides }
    const clientIp = resolveRateLimitClientIp(request.request, dependencies)

    if (clientIp === UNKNOWN_CLIENT_IP) {
        dependencies.warn('client IP unavailable; applying unknown-IP and user limits')
    }

    const rateLimitDependencies: RateLimitDependencies = {
        getClient: dependencies.getClient,
    }
    const [ip, user] = await Promise.all([
        consumeRateLimit(
            { ...AUTH_RATE_LIMITS.login.ip, identifier: clientIp },
            rateLimitDependencies,
        ),
        consumeRateLimitKey(LOGIN_MFA_USER_RATE_LIMIT, userKey, rateLimitDependencies),
    ])

    return { ip, user }
}

export async function enforcePasswordChangeRateLimit(
    userId: string,
    overrides: Partial<RateLimitDependencies> = {},
): Promise<RateLimitResult> {
    const userKey = createUserRateLimitKey(
        SENSITIVE_ACTION_RATE_LIMITS.passwordChange.scope,
        userId,
    )

    return consumeRateLimitKey(SENSITIVE_ACTION_RATE_LIMITS.passwordChange, userKey, overrides)
}

export async function enforceInviteRateLimit(
    request: InviteRateLimitRequest,
    overrides: Partial<RateLimitDependencies> = {},
): Promise<InviteRateLimitResult> {
    const actorKey = createUserRateLimitKey(
        SENSITIVE_ACTION_RATE_LIMITS.invite.actor.scope,
        request.actorUserId,
    )
    const [actor, email] = await Promise.all([
        consumeRateLimitKey(SENSITIVE_ACTION_RATE_LIMITS.invite.actor, actorKey, overrides),
        consumeRateLimit(
            { ...SENSITIVE_ACTION_RATE_LIMITS.invite.email, identifier: request.email },
            overrides,
        ),
    ])

    return { actor, email }
}
