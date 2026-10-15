import { describe, expect, test } from 'bun:test'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { validateControllerEncryption } from '../../../../../../scripts/backup/format.ts'
import type { StateArchiveEntry } from '../../../../../../scripts/backup/Types/format.types.ts'

const connectionId = '01924df0-1111-7111-8111-111111111111'
const secondConnectionId = '01924df0-2222-7222-8222-222222222222'
const actorId = '01924df0-3333-7333-8333-333333333333'
const zoneId = 'a'.repeat(32)
const key = Buffer.alloc(32, 91)
const token = 'controlled-cloudflare-token'

function connection(id = connectionId) {
    const nonce = Buffer.alloc(12, id === connectionId ? 7 : 8)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(Buffer.from(`dns-connection:${id}:v1`))
    const ciphertext = Buffer.concat([cipher.update(token), cipher.final(), cipher.getAuthTag()])
    return {
        metadata: {
            id,
            provider: 'cloudflare',
            ownership: 'instance',
            name: id === connectionId ? 'Home zones' : 'Other zones',
            createdByUserId: actorId,
            revision: 1,
            zones: [{ id: zoneId, name: 'example.test' }],
            references: [] as { zoneId: string; consumer: { type: string; id: string } }[],
            createdAt: '2026-10-16T00:00:00Z',
            updatedAt: '2026-10-16T00:00:00Z',
        },
        secret: { version: 1, nonce: [...nonce], ciphertext: [...ciphertext] },
    }
}

function entry(document: unknown): StateArchiveEntry {
    return {
        name: 'dns-connections.json',
        directory: false,
        bytes: Buffer.from(JSON.stringify(document)),
    }
}

function decrypt(ciphertext: Uint8Array, nonce: Uint8Array, context: string): void {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(ciphertext.subarray(-16))
    const plaintext = Buffer.concat([
        decipher.update(ciphertext.subarray(0, -16)),
        decipher.final(),
    ])
    expect(plaintext.toString()).toBe(token)
}

describe('Cloudflare connection backup compatibility', () => {
    test('accepts pre-feature backups without a connection registry', () => {
        let calls = 0
        validateControllerEncryption([], () => {
            calls += 1
        })
        validateControllerEncryption([entry({ version: 1, connections: [] })], () => {
            calls += 1
        })
        expect(calls).toBe(0)
    })

    test('validates every encrypted token with connection-specific associated data', () => {
        const archiveEntry = entry({
            version: 1,
            connections: [connection(), connection(secondConnectionId)],
        })
        expect(Buffer.from(archiveEntry.bytes).toString()).not.toContain(token)
        const contexts: string[] = []
        validateControllerEncryption([archiveEntry], (ciphertext, nonce, context) => {
            contexts.push(context)
            decrypt(ciphertext, nonce, context)
        })
        expect(contexts).toEqual([
            `dns-connection:${connectionId}:v1`,
            `dns-connection:${secondConnectionId}:v1`,
        ])
    })

    test('rejects ciphertext moved to a different connection or a mismatched key', () => {
        const swapped = connection()
        swapped.metadata.id = secondConnectionId
        expect(() =>
            validateControllerEncryption([entry({ version: 1, connections: [swapped] })], decrypt),
        ).toThrow()
        expect(() =>
            validateControllerEncryption(
                [entry({ version: 1, connections: [connection()] })],
                (ciphertext, nonce, context) => {
                    const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 92), nonce)
                    decipher.setAAD(Buffer.from(context))
                    decipher.setAuthTag(ciphertext.subarray(-16))
                    decipher.update(ciphertext.subarray(0, -16))
                    decipher.final()
                },
            ),
        ).toThrow()
    })

    test('retains well-formed consumer references and rejects zone escapes', () => {
        const stored = connection()
        stored.metadata.references = [{ zoneId, consumer: { type: 'ddns', id: actorId } }]
        expect(() =>
            validateControllerEncryption([entry({ version: 1, connections: [stored] })], decrypt),
        ).not.toThrow()
        stored.metadata.references[0]!.zoneId = 'b'.repeat(32)
        expect(() =>
            validateControllerEncryption([entry({ version: 1, connections: [stored] })], decrypt),
        ).toThrow('invalid DNS connection state metadata')
    })

    test('rejects duplicate connections, case-insensitive names, zones, and references', () => {
        const first = connection()
        const duplicateName = connection(secondConnectionId)
        duplicateName.metadata.name = 'HOME ZONES'
        const duplicateZones = connection()
        duplicateZones.metadata.zones.push({ ...duplicateZones.metadata.zones[0]! })
        const duplicateReferences = connection()
        const usage = { zoneId, consumer: { type: 'dns01', id: actorId } }
        duplicateReferences.metadata.references = [usage, usage]
        for (const connections of [
            [first, first],
            [first, duplicateName],
            [duplicateZones],
            [duplicateReferences],
        ]) {
            expect(() =>
                validateControllerEncryption([entry({ version: 1, connections })], decrypt),
            ).toThrow('invalid DNS connection state metadata')
        }
    })

    test('fails closed on unsupported versions, plaintext fields and malformed encrypted data', () => {
        const valid = connection()
        const invalidDocuments = [
            { version: 2, connections: [valid] },
            { version: 1, connections: [{ ...valid, apiToken: token }] },
            { version: 1, connections: [{ ...valid, secret: { ...valid.secret, nonce: [1] } }] },
            {
                version: 1,
                connections: [
                    {
                        ...valid,
                        secret: { ...valid.secret, ciphertext: [256, ...valid.secret.ciphertext] },
                    },
                ],
            },
            {
                version: 1,
                connections: [{ ...valid, metadata: { ...valid.metadata, references: null } }],
            },
        ]
        for (const document of invalidDocuments) {
            expect(() => validateControllerEncryption([entry(document)], decrypt)).toThrow(
                'invalid DNS connection state metadata',
            )
        }
        expect(() =>
            validateControllerEncryption(
                [{ ...entry(null), bytes: Buffer.from('{broken') }],
                decrypt,
            ),
        ).toThrow('invalid DNS connection state metadata')
        expect(() =>
            validateControllerEncryption([{ ...entry(null), directory: true }], decrypt),
        ).toThrow('invalid DNS connection state metadata')
    })
})
