import { deepStrictEqual } from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'

import { decodeApplicationKey } from './alpha4-persistence/crypto'
import { seedAlpha4PersistenceFixture } from './alpha4-persistence/seed'
import {
    readAlpha4PersistenceSnapshot as readSnapshotFromStorage,
    readContainerFile,
    readEncryptedRequestParts,
} from './alpha4-persistence/storage'
import type {
    Alpha4PersistenceCommandInput,
    Alpha4PersistenceFixture,
    Alpha4PersistenceSnapshot,
    AssertAlpha4PersistenceFixtureInput,
    AssertAlpha4PersistenceSnapshotInput,
    Command,
    SeedAlpha4PersistenceFixtureInput,
} from './alpha4-persistence/types'

const appEncryptionKeyFile = '/run/rentnerproxy/app-key/value'

function validateCommandInput(input: Alpha4PersistenceCommandInput): void {
    if (!input.containerId.trim() || input.containerId.length > 256) {
        throw new Error('Alpha 4 fixture container id is invalid.')
    }
}

export async function readAlpha4PersistenceSnapshot(
    input: AssertAlpha4PersistenceFixtureInput,
): Promise<Alpha4PersistenceSnapshot> {
    validateCommandInput(input)
    return readSnapshotFromStorage(input.command, input.containerId, input.fixture)
}

export async function assertAlpha4PersistenceFixture(
    input: AssertAlpha4PersistenceSnapshotInput,
): Promise<void> {
    validateCommandInput(input)
    const actual = await readAlpha4PersistenceSnapshot(input)
    try {
        deepStrictEqual(actual, input.expected)
    } catch {
        throw new Error('Alpha 4 persistence fixture snapshot did not survive backup restore.')
    }
}

export async function assertAlpha4PersistenceRequestDecrypts(
    input: AssertAlpha4PersistenceFixtureInput,
): Promise<void> {
    validateCommandInput(input)
    try {
        const encodedKey = (
            await readContainerFile(input.command, input.containerId, appEncryptionKeyFile)
        ).trim()
        const key = decodeApplicationKey(encodedKey)
        if (key.digest !== input.fixture.applicationKeyDigest) {
            throw new Error('application key changed')
        }
        const encrypted = await readEncryptedRequestParts(
            input.command,
            input.containerId,
            input.fixture.jobId,
        )
        const decipher = createDecipheriv('aes-256-gcm', key.bytes, encrypted.iv)
        decipher.setAAD(Buffer.from(input.fixture.requestContext, 'utf8'))
        decipher.setAuthTag(encrypted.ciphertext.subarray(-16))
        const plaintext = Buffer.concat([
            decipher.update(encrypted.ciphertext.subarray(0, -16)),
            decipher.final(),
        ]).toString('utf8')
        const request: unknown = JSON.parse(plaintext)
        deepStrictEqual(request, input.fixture.request)
    } catch {
        throw new Error('Alpha 4 persistence fixture encrypted request could not be decrypted.')
    }
}

export { seedAlpha4PersistenceFixture }
export type {
    Alpha4PersistenceCommandInput,
    Alpha4PersistenceFixture,
    Alpha4PersistenceSnapshot,
    AssertAlpha4PersistenceFixtureInput,
    AssertAlpha4PersistenceSnapshotInput,
    Command,
    SeedAlpha4PersistenceFixtureInput,
}
