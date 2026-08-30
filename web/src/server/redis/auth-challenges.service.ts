import '@tanstack/react-start/server-only'

import {
    CHALLENGE_VERIFICATION_LOCK_DURATION_MS,
    MFA_CHALLENGE_MAX_ATTEMPTS,
} from '../../config/auth-security.config'
import { createOpaqueToken, isValidOpaqueToken } from '../Auth/Core/tokens.server'
import { getRedisClient } from './client.server'
import type { RedisCommandClient } from './Types/redis.types'

const KEY_PREFIX = 'rentnerproxy:auth-challenge'

const CONSUME_CODE_CHALLENGE_SCRIPT = `
local lock = redis.call('GET', KEYS[2])
if lock ~= ARGV[1] then return {0} end
local value = redis.call('GET', KEYS[1])
if not value then
  redis.call('DEL', KEYS[2])
  return {1}
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return {2, value}
`

const FAIL_CODE_CHALLENGE_SCRIPT = `
local lock = redis.call('GET', KEYS[2])
if lock ~= ARGV[1] then return {0} end
local value = redis.call('GET', KEYS[1])
if not value then
  redis.call('DEL', KEYS[2])
  return {1}
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return {1}
end
local data = cjson.decode(value)
local attempts = (tonumber(data.attempts) or 0) + 1
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return {3, attempts}
end
data.attempts = attempts
redis.call('SET', KEYS[1], cjson.encode(data), 'PX', ttl)
redis.call('DEL', KEYS[2])
return {2, attempts}
`

const RELEASE_CODE_CHALLENGE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
return 1
`

export type AuthChallengeKind =
    | 'login-mfa'
    | 'totp-setup'
    | 'webauthn-authentication'
    | 'webauthn-reauthentication'
    | 'webauthn-registration'

interface BaseChallenge {
    readonly createdAt: string
    readonly kind: AuthChallengeKind
}

export interface LoginMfaChallenge extends BaseChallenge {
    readonly attempts: number
    readonly kind: 'login-mfa'
    readonly userId: string
}

export interface TotpSetupChallenge extends BaseChallenge {
    readonly attempts: number
    readonly ciphertext: string
    readonly iv: string
    readonly kind: 'totp-setup'
    readonly sessionId: string
    readonly userId: string
}

export interface WebAuthnRegistrationChallenge extends BaseChallenge {
    readonly challenge: string
    readonly kind: 'webauthn-registration'
    readonly sessionId: string
    readonly userId: string
}

export interface WebAuthnAuthenticationChallenge extends BaseChallenge {
    readonly challenge: string
    readonly kind: 'webauthn-authentication'
}

export interface WebAuthnReauthenticationChallenge extends BaseChallenge {
    readonly challenge: string
    readonly kind: 'webauthn-reauthentication'
    readonly sessionId: string
    readonly userId: string
}

export type AuthChallenge =
    | LoginMfaChallenge
    | TotpSetupChallenge
    | WebAuthnAuthenticationChallenge
    | WebAuthnReauthenticationChallenge
    | WebAuthnRegistrationChallenge

export interface IssuedAuthChallenge {
    readonly expiresAt: Date
    readonly id: string
}

export interface CodeChallengeVerification<TChallenge extends AuthChallenge> {
    readonly challenge: TChallenge
    readonly id: string
    readonly lockToken: string
}

export interface AuthChallengeDependencies {
    readonly getClient: () => RedisCommandClient | null
}

export class AuthChallengeUnavailableError extends Error {
    constructor() {
        super('Authentication challenge storage is unavailable.')
        this.name = 'AuthChallengeUnavailableError'
    }
}

export class AuthChallengeStateError extends Error {
    constructor() {
        super('Authentication challenge state is invalid.')
        this.name = 'AuthChallengeStateError'
    }
}

function getChallengeKey(kind: AuthChallengeKind, id: string): string {
    return `${KEY_PREFIX}:${kind}:${id}`
}

function getChallengeLockKey(kind: AuthChallengeKind, id: string): string {
    return `${KEY_PREFIX}:verification-lock:${kind}:${id}`
}

const defaultDependencies: AuthChallengeDependencies = {
    getClient: getRedisClient,
}

function getClient(overrides: Partial<AuthChallengeDependencies>): RedisCommandClient {
    const dependencies = { ...defaultDependencies, ...overrides }
    const client = dependencies.getClient()

    if (!client) {
        throw new AuthChallengeUnavailableError()
    }

    return client
}

function isChallengeKind(value: unknown): value is AuthChallengeKind {
    return (
        value === 'login-mfa' ||
        value === 'totp-setup' ||
        value === 'webauthn-authentication' ||
        value === 'webauthn-reauthentication' ||
        value === 'webauthn-registration'
    )
}

function parseChallenge(value: unknown, expectedKind: AuthChallengeKind): AuthChallenge | null {
    if (typeof value !== 'string') {
        return null
    }

    try {
        const parsed: unknown = JSON.parse(value)

        if (!parsed || typeof parsed !== 'object') {
            return null
        }

        const challenge = parsed as Partial<AuthChallenge>

        if (
            challenge.kind !== expectedKind ||
            !isChallengeKind(challenge.kind) ||
            typeof challenge.createdAt !== 'string'
        ) {
            return null
        }

        switch (challenge.kind) {
            case 'login-mfa':
                return typeof challenge.userId === 'string' &&
                    typeof challenge.attempts === 'number'
                    ? (challenge as LoginMfaChallenge)
                    : null
            case 'totp-setup':
                return typeof challenge.userId === 'string' &&
                    typeof challenge.sessionId === 'string' &&
                    typeof challenge.ciphertext === 'string' &&
                    typeof challenge.iv === 'string' &&
                    typeof challenge.attempts === 'number'
                    ? (challenge as TotpSetupChallenge)
                    : null
            case 'webauthn-registration':
            case 'webauthn-reauthentication':
                return typeof challenge.userId === 'string' &&
                    typeof challenge.sessionId === 'string' &&
                    typeof challenge.challenge === 'string'
                    ? (challenge as
                          | WebAuthnRegistrationChallenge
                          | WebAuthnReauthenticationChallenge)
                    : null
            case 'webauthn-authentication':
                return typeof challenge.challenge === 'string'
                    ? (challenge as WebAuthnAuthenticationChallenge)
                    : null
        }
    } catch {
        return null
    }
}

function ensureChallengeInput(challenge: AuthChallenge): void {
    if (!isChallengeKind(challenge.kind) || !challenge.createdAt) {
        throw new AuthChallengeStateError()
    }
}

async function send(
    command: string,
    args: Array<string>,
    overrides: Partial<AuthChallengeDependencies>,
): Promise<unknown> {
    try {
        return await getClient(overrides).send(command, args)
    } catch (error) {
        if (error instanceof AuthChallengeUnavailableError) {
            throw error
        }

        throw new AuthChallengeUnavailableError()
    }
}

function isOkay(value: unknown): boolean {
    return value === 'OK' || value === true
}

export async function createAuthChallenge(
    challenge: AuthChallenge,
    durationMs: number,
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<IssuedAuthChallenge> {
    ensureChallengeInput(challenge)

    if (!Number.isSafeInteger(durationMs) || durationMs < 1) {
        throw new AuthChallengeStateError()
    }

    const id = createOpaqueToken()
    const result = await send(
        'SET',
        [
            getChallengeKey(challenge.kind, id),
            JSON.stringify(challenge),
            'NX',
            'PX',
            String(durationMs),
        ],
        overrides,
    )

    if (!isOkay(result)) {
        throw new AuthChallengeUnavailableError()
    }

    return { expiresAt: new Date(Date.now() + durationMs), id }
}

export async function consumeAuthChallenge<TKind extends AuthChallengeKind>(
    kind: TKind,
    id: string,
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<Extract<AuthChallenge, { kind: TKind }> | null> {
    if (!isValidOpaqueToken(id)) {
        return null
    }

    const result = await send('GETDEL', [getChallengeKey(kind, id)], overrides)
    const challenge = parseChallenge(result, kind)

    if (result !== null && !challenge) {
        throw new AuthChallengeStateError()
    }

    return challenge as Extract<AuthChallenge, { kind: TKind }> | null
}

export async function getAuthChallenge<TKind extends AuthChallengeKind>(
    kind: TKind,
    id: string,
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<Extract<AuthChallenge, { kind: TKind }> | null> {
    if (!isValidOpaqueToken(id)) {
        return null
    }

    const result = await send('GET', [getChallengeKey(kind, id)], overrides)
    const challenge = parseChallenge(result, kind)

    if (result !== null && !challenge) {
        throw new AuthChallengeStateError()
    }

    return challenge as Extract<AuthChallenge, { kind: TKind }> | null
}

export async function acquireCodeChallengeVerification<TKind extends 'login-mfa' | 'totp-setup'>(
    kind: TKind,
    id: string,
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<CodeChallengeVerification<Extract<AuthChallenge, { kind: TKind }>> | null> {
    if (!isValidOpaqueToken(id)) {
        return null
    }

    const lockToken = createOpaqueToken()
    const lockKey = getChallengeLockKey(kind, id)
    const lockResult = await send(
        'SET',
        [lockKey, lockToken, 'NX', 'PX', String(CHALLENGE_VERIFICATION_LOCK_DURATION_MS)],
        overrides,
    )

    if (lockResult === null) {
        return null
    }

    if (!isOkay(lockResult)) {
        throw new AuthChallengeUnavailableError()
    }

    const rawChallenge = await send('GET', [getChallengeKey(kind, id)], overrides)
    const challenge = parseChallenge(rawChallenge, kind)

    if (
        !challenge ||
        !('attempts' in challenge) ||
        challenge.attempts >= MFA_CHALLENGE_MAX_ATTEMPTS
    ) {
        await releaseCodeChallengeVerification({ id, kind, lockToken }, overrides)
        return null
    }

    return { challenge: challenge as Extract<AuthChallenge, { kind: TKind }>, id, lockToken }
}

export async function consumeCodeChallengeVerification<TKind extends 'login-mfa' | 'totp-setup'>(
    verification: Pick<
        CodeChallengeVerification<Extract<AuthChallenge, { kind: TKind }>>,
        'id' | 'lockToken'
    > & {
        readonly kind: TKind
    },
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<Extract<AuthChallenge, { kind: TKind }> | null> {
    const result = await send(
        'EVAL',
        [
            CONSUME_CODE_CHALLENGE_SCRIPT,
            '2',
            getChallengeKey(verification.kind, verification.id),
            getChallengeLockKey(verification.kind, verification.id),
            verification.lockToken,
        ],
        overrides,
    )

    if (!Array.isArray(result) || typeof result[0] !== 'number') {
        throw new AuthChallengeUnavailableError()
    }

    if (result[0] !== 2) {
        return null
    }

    const challenge = parseChallenge(result[1], verification.kind)

    if (!challenge) {
        throw new AuthChallengeStateError()
    }

    return challenge as Extract<AuthChallenge, { kind: TKind }>
}

export async function failCodeChallengeVerification<TKind extends 'login-mfa' | 'totp-setup'>(
    verification: Pick<
        CodeChallengeVerification<Extract<AuthChallenge, { kind: TKind }>>,
        'id' | 'lockToken'
    > & {
        readonly kind: TKind
    },
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<'expired' | 'invalid' | 'locked'> {
    const result = await send(
        'EVAL',
        [
            FAIL_CODE_CHALLENGE_SCRIPT,
            '2',
            getChallengeKey(verification.kind, verification.id),
            getChallengeLockKey(verification.kind, verification.id),
            verification.lockToken,
            String(MFA_CHALLENGE_MAX_ATTEMPTS),
        ],
        overrides,
    )

    if (!Array.isArray(result) || typeof result[0] !== 'number') {
        throw new AuthChallengeUnavailableError()
    }

    if (result[0] === 2) {
        return 'invalid'
    }

    if (result[0] === 3) {
        return 'locked'
    }

    return 'expired'
}

export async function releaseCodeChallengeVerification<TKind extends 'login-mfa' | 'totp-setup'>(
    verification: Pick<
        CodeChallengeVerification<Extract<AuthChallenge, { kind: TKind }>>,
        'id' | 'lockToken'
    > & {
        readonly kind: TKind
    },
    overrides: Partial<AuthChallengeDependencies> = {},
): Promise<void> {
    await send(
        'EVAL',
        [
            RELEASE_CODE_CHALLENGE_LOCK_SCRIPT,
            '1',
            getChallengeLockKey(verification.kind, verification.id),
            verification.lockToken,
        ],
        overrides,
    )
}
