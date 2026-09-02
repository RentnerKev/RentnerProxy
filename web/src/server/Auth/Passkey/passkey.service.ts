import '@tanstack/react-start/server-only'

import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type AuthenticatorTransportFuture,
    type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { and, desc, eq } from 'drizzle-orm'

import {
    PASSKEY_NAME_MAX_LENGTH,
    WEBAUTHN_CHALLENGE_DURATION_MS,
    WEBAUTHN_TIMEOUT_MS,
} from '../../../config/auth-security.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { passkeys, users } from '../../../db/schema'
import { getRuntimeWebAuthnConfiguration } from '../../Configuration/management-origin.server'
import {
    createAuthChallenge,
    consumeAuthChallenge,
    type WebAuthnReauthenticationChallenge,
} from '../../redis/auth-challenges.service'
import {
    requireRecentAuthenticationForSession,
    requireSessionPermission,
} from '../Access/authorization.service'
import {
    createSessionInTransaction,
    markSessionReauthenticatedInTransaction,
    requireRecentSessionInTransaction,
    revokeOtherUserSessionsInTransaction,
} from '../Access/sessions.service'
import { requirePermissionInTransaction } from '../Access/rbac.service'
import { getAuthDatabase } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'
import type { CurrentSession } from '../Core/Types/auth-service.types'

export interface PasskeySummary {
    readonly createdAt: Date
    readonly id: string
    readonly lastUsedAt: Date | null
    readonly name: string
}

export type PasskeyAuthenticationResult =
    | {
          readonly code: 'authentication_failed' | 'challenge_expired'
          readonly success: false
      }
    | {
          readonly session: {
              readonly expiresAt: Date
              readonly id: string
              readonly token: string
          }
          readonly success: true
      }

function unavailable(): AuthDomainError {
    return new AuthDomainError('service_unavailable', 'Passkey authentication is unavailable.')
}

function normalizePasskeyName(name: string | undefined): string {
    const normalized = name?.trim() ?? ''

    if (!normalized) {
        return 'Passkey'
    }

    if (normalized.length > PASSKEY_NAME_MAX_LENGTH) {
        throw new AuthDomainError('invalid_input', 'Passkey name is too long.')
    }

    return normalized
}

function copyBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    return copy
}

function toWebAuthnUserId(userId: string): Uint8Array<ArrayBuffer> {
    const hex = userId.replaceAll('-', '')

    if (!/^[a-f\d]{32}$/i.test(hex)) {
        throw unavailable()
    }

    return copyBytes(Buffer.from(hex, 'hex'))
}

function toStoredTransports(value: ReadonlyArray<string>): Array<AuthenticatorTransportFuture> {
    const valid = new Set<AuthenticatorTransportFuture>([
        'ble',
        'cable',
        'hybrid',
        'internal',
        'nfc',
        'smart-card',
        'usb',
    ])

    return value.filter((transport): transport is AuthenticatorTransportFuture =>
        valid.has(transport as AuthenticatorTransportFuture),
    )
}

async function requireWebAuthnConfiguration() {
    const configuration = await getRuntimeWebAuthnConfiguration()

    if (!configuration) {
        throw unavailable()
    }

    return configuration
}

export async function getPasskeysForUserService(userId: string): Promise<Array<PasskeySummary>> {
    return getAuthDatabase()
        .select({
            createdAt: passkeys.createdAt,
            id: passkeys.id,
            lastUsedAt: passkeys.lastUsedAt,
            name: passkeys.name,
        })
        .from(passkeys)
        .where(eq(passkeys.userId, userId))
        .orderBy(desc(passkeys.createdAt))
}

export async function beginPasskeyRegistrationService(currentSession: CurrentSession) {
    await requireRecentAuthenticationForSession(currentSession)
    await requireSessionPermission(currentSession, PERMISSIONS.ACCOUNT_UPDATE)

    const configuration = await requireWebAuthnConfiguration()
    const existingPasskeys = await getAuthDatabase()
        .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
        .from(passkeys)
        .where(eq(passkeys.userId, currentSession.user.id))
    const options = await generateRegistrationOptions({
        rpName: configuration.rpName,
        rpID: configuration.rpId,
        userName: currentSession.user.email,
        userID: toWebAuthnUserId(currentSession.user.id),
        userDisplayName: currentSession.user.displayName,
        timeout: WEBAUTHN_TIMEOUT_MS,
        attestationType: 'none',
        excludeCredentials: existingPasskeys.map((passkey) => ({
            id: passkey.credentialId,
            transports: toStoredTransports(passkey.transports),
        })),
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
        },
    })
    const issued = await createAuthChallenge(
        {
            challenge: options.challenge,
            createdAt: new Date().toISOString(),
            kind: 'webauthn-registration',
            sessionId: currentSession.id,
            userId: currentSession.user.id,
        },
        WEBAUTHN_CHALLENGE_DURATION_MS,
    )

    return { expiresAt: issued.expiresAt, flowId: issued.id, options }
}

export async function finishPasskeyRegistrationService(input: {
    currentSession: CurrentSession
    flowId: string
    name?: string
    response: RegistrationResponseJSON
}): Promise<{
    readonly code?: 'challenge_expired' | 'registration_failed'
    readonly success: boolean
}> {
    await requireRecentAuthenticationForSession(input.currentSession)
    await requireSessionPermission(input.currentSession, PERMISSIONS.ACCOUNT_UPDATE)

    const configuration = await requireWebAuthnConfiguration()
    const challenge = await consumeAuthChallenge('webauthn-registration', input.flowId)

    if (
        !challenge ||
        challenge.userId !== input.currentSession.user.id ||
        challenge.sessionId !== input.currentSession.id
    ) {
        return { code: 'challenge_expired', success: false }
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>

    try {
        verification = await verifyRegistrationResponse({
            response: input.response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: configuration.origin,
            expectedRPID: configuration.rpId,
            requireUserVerification: true,
        })
    } catch {
        return { code: 'registration_failed', success: false }
    }

    if (!verification.verified) {
        return { code: 'registration_failed', success: false }
    }

    const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo
    const inserted = await getAuthDatabase().transaction(async (transaction) => {
        await requireRecentSessionInTransaction(transaction, input.currentSession)
        await requirePermissionInTransaction(
            transaction,
            input.currentSession.user.id,
            PERMISSIONS.ACCOUNT_UPDATE,
        )
        const rows = await transaction
            .insert(passkeys)
            .values({
                backedUp: credentialBackedUp,
                counter: credential.counter,
                credentialId: credential.id,
                deviceType: credentialDeviceType,
                name: normalizePasskeyName(input.name),
                publicKey: credential.publicKey,
                transports: toStoredTransports(input.response.response.transports ?? []),
                userId: input.currentSession.user.id,
            })
            .onConflictDoNothing({ target: passkeys.credentialId })
            .returning({ id: passkeys.id })

        if (rows.length !== 1) {
            return false
        }

        await revokeOtherUserSessionsInTransaction(
            transaction,
            input.currentSession.user.id,
            input.currentSession.id,
        )
        return true
    })

    return inserted ? { success: true } : { code: 'registration_failed', success: false }
}

export async function beginDiscoverablePasskeyAuthenticationService() {
    const configuration = await requireWebAuthnConfiguration()
    const options = await generateAuthenticationOptions({
        rpID: configuration.rpId,
        timeout: WEBAUTHN_TIMEOUT_MS,
        userVerification: 'required',
    })
    const issued = await createAuthChallenge(
        {
            challenge: options.challenge,
            createdAt: new Date().toISOString(),
            kind: 'webauthn-authentication',
        },
        WEBAUTHN_CHALLENGE_DURATION_MS,
    )

    return { expiresAt: issued.expiresAt, flowId: issued.id, options }
}

export async function finishDiscoverablePasskeyAuthenticationService(input: {
    flowId: string
    response: AuthenticationResponseJSON
}): Promise<PasskeyAuthenticationResult> {
    const configuration = await requireWebAuthnConfiguration()
    const challenge = await consumeAuthChallenge('webauthn-authentication', input.flowId)

    if (!challenge) {
        return { code: 'challenge_expired', success: false }
    }

    const rows = await getAuthDatabase()
        .select({ passkey: passkeys, userId: users.id, userStatus: users.status })
        .from(passkeys)
        .innerJoin(users, eq(users.id, passkeys.userId))
        .where(eq(passkeys.credentialId, input.response.id))
        .limit(1)
    const row = rows.at(0)

    if (!row || row.userStatus !== 'active') {
        return { code: 'authentication_failed', success: false }
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
    const expectedUserHandle = Buffer.from(toWebAuthnUserId(row.userId)).toString('base64url')

    if (input.response.response.userHandle !== expectedUserHandle) {
        return { code: 'authentication_failed', success: false }
    }

    try {
        verification = await verifyAuthenticationResponse({
            response: input.response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: configuration.origin,
            expectedRPID: configuration.rpId,
            credential: {
                counter: row.passkey.counter,
                id: row.passkey.credentialId,
                publicKey: copyBytes(row.passkey.publicKey),
                transports: toStoredTransports(row.passkey.transports),
            },
            requireUserVerification: true,
        })
    } catch {
        return { code: 'authentication_failed', success: false }
    }

    if (!verification.verified) {
        return { code: 'authentication_failed', success: false }
    }

    try {
        return await getAuthDatabase().transaction(async (transaction) => {
            const updated = await transaction
                .update(passkeys)
                .set({
                    backedUp: verification.authenticationInfo.credentialBackedUp,
                    counter: verification.authenticationInfo.newCounter,
                    deviceType: verification.authenticationInfo.credentialDeviceType,
                    lastUsedAt: new Date(),
                })
                .where(
                    and(eq(passkeys.id, row.passkey.id), eq(passkeys.counter, row.passkey.counter)),
                )
                .returning({ id: passkeys.id })

            if (updated.length !== 1) {
                return { code: 'authentication_failed' as const, success: false as const }
            }

            const session = await createSessionInTransaction(transaction, row.userId)
            return {
                session: {
                    expiresAt: session.expiresAt,
                    id: session.id,
                    token: session.token,
                },
                success: true as const,
            }
        })
    } catch (error) {
        if (error instanceof AuthDomainError && error.code === 'user_not_active') {
            return { code: 'authentication_failed', success: false }
        }

        throw error
    }
}

export async function beginPasskeyReauthenticationService(currentSession: CurrentSession) {
    const configuration = await requireWebAuthnConfiguration()
    const knownPasskeys = await getAuthDatabase()
        .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
        .from(passkeys)
        .where(eq(passkeys.userId, currentSession.user.id))

    if (knownPasskeys.length === 0) {
        throw new AuthDomainError('invalid_input', 'No passkey is available.')
    }

    const options = await generateAuthenticationOptions({
        rpID: configuration.rpId,
        timeout: WEBAUTHN_TIMEOUT_MS,
        userVerification: 'required',
        allowCredentials: knownPasskeys.map((passkey) => ({
            id: passkey.credentialId,
            transports: toStoredTransports(passkey.transports),
        })),
    })
    const issued = await createAuthChallenge(
        {
            challenge: options.challenge,
            createdAt: new Date().toISOString(),
            kind: 'webauthn-reauthentication',
            sessionId: currentSession.id,
            userId: currentSession.user.id,
        },
        WEBAUTHN_CHALLENGE_DURATION_MS,
    )

    return { expiresAt: issued.expiresAt, flowId: issued.id, options }
}

export async function finishPasskeyReauthenticationService(input: {
    currentSession: CurrentSession
    flowId: string
    response: AuthenticationResponseJSON
}): Promise<{
    readonly code?: 'authentication_failed' | 'challenge_expired'
    readonly success: boolean
}> {
    const configuration = await requireWebAuthnConfiguration()
    const challenge = await consumeAuthChallenge('webauthn-reauthentication', input.flowId)

    if (!isBoundReauthenticationChallenge(challenge, input.currentSession)) {
        return { code: 'challenge_expired', success: false }
    }

    const rows = await getAuthDatabase()
        .select({ passkey: passkeys })
        .from(passkeys)
        .where(
            and(
                eq(passkeys.credentialId, input.response.id),
                eq(passkeys.userId, input.currentSession.user.id),
            ),
        )
        .limit(1)
    const passkey = rows.at(0)?.passkey

    if (!passkey) {
        return { code: 'authentication_failed', success: false }
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>

    try {
        verification = await verifyAuthenticationResponse({
            response: input.response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: configuration.origin,
            expectedRPID: configuration.rpId,
            credential: {
                counter: passkey.counter,
                id: passkey.credentialId,
                publicKey: copyBytes(passkey.publicKey),
                transports: toStoredTransports(passkey.transports),
            },
            requireUserVerification: true,
        })
    } catch {
        return { code: 'authentication_failed', success: false }
    }

    if (!verification.verified) {
        return { code: 'authentication_failed', success: false }
    }

    const completed = await getAuthDatabase().transaction(async (transaction) => {
        const updated = await transaction
            .update(passkeys)
            .set({
                backedUp: verification.authenticationInfo.credentialBackedUp,
                counter: verification.authenticationInfo.newCounter,
                deviceType: verification.authenticationInfo.credentialDeviceType,
                lastUsedAt: new Date(),
            })
            .where(and(eq(passkeys.id, passkey.id), eq(passkeys.counter, passkey.counter)))
            .returning({ id: passkeys.id })

        if (updated.length !== 1) {
            return false
        }

        return markSessionReauthenticatedInTransaction(transaction, input.currentSession)
    })

    return completed ? { success: true } : { code: 'authentication_failed', success: false }
}

export async function renamePasskeyService(input: {
    currentSession: CurrentSession
    name: string
    passkeyId: string
}): Promise<boolean> {
    return getAuthDatabase().transaction(async (transaction) => {
        await requireRecentSessionInTransaction(transaction, input.currentSession)
        await requirePermissionInTransaction(
            transaction,
            input.currentSession.user.id,
            PERMISSIONS.ACCOUNT_UPDATE,
        )
        const updated = await transaction
            .update(passkeys)
            .set({ name: normalizePasskeyName(input.name) })
            .where(
                and(
                    eq(passkeys.id, input.passkeyId),
                    eq(passkeys.userId, input.currentSession.user.id),
                ),
            )
            .returning({ id: passkeys.id })

        return updated.length === 1
    })
}

export async function deletePasskeyService(input: {
    currentSession: CurrentSession
    passkeyId: string
}): Promise<boolean> {
    await requireRecentAuthenticationForSession(input.currentSession)
    await requireSessionPermission(input.currentSession, PERMISSIONS.ACCOUNT_UPDATE)

    return getAuthDatabase().transaction(async (transaction) => {
        await requireRecentSessionInTransaction(transaction, input.currentSession)
        await requirePermissionInTransaction(
            transaction,
            input.currentSession.user.id,
            PERMISSIONS.ACCOUNT_UPDATE,
        )
        const deleted = await transaction
            .delete(passkeys)
            .where(
                and(
                    eq(passkeys.id, input.passkeyId),
                    eq(passkeys.userId, input.currentSession.user.id),
                ),
            )
            .returning({ id: passkeys.id })

        if (deleted.length !== 1) {
            return false
        }

        await revokeOtherUserSessionsInTransaction(
            transaction,
            input.currentSession.user.id,
            input.currentSession.id,
        )
        return true
    })
}

function isBoundReauthenticationChallenge(
    challenge: WebAuthnReauthenticationChallenge | null,
    session: CurrentSession,
): challenge is WebAuthnReauthenticationChallenge {
    return Boolean(
        challenge && challenge.sessionId === session.id && challenge.userId === session.user.id,
    )
}
