import type { ValkeyCommandClient } from './valkey.types.ts'

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
    readonly getClient: () => ValkeyCommandClient | null
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

export type RateLimitUnavailableReason =
    | 'invalid_configuration'
    | 'invalid_policy'
    | 'invalid_response'
    | 'request_failed'
