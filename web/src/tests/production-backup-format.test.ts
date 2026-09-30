import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import {
    assertDeploymentCompatible,
    parseBackupMetadata,
    validateControllerEncryption,
    validateStateArchive,
    verifyBackupArtifact,
    type DeploymentSettings,
    type StateArchiveEntry,
} from '../../../scripts/production-backup-format'

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const fixedSha = 'a'.repeat(64)
const emptyBytes = new Uint8Array([1, 2, 3])

function v3Metadata() {
    return {
        applicationEncryptionKey: {
            bytes: 32,
            file: 'app-encryption-key',
            sha256: fixedSha,
        },
        controllerState: {
            archive: 'controller-state.tar',
            bytes: 3,
            sha256: sha256(emptyBytes),
        },
        createdAt: '2026-09-30T00:00:00.000Z',
        format: 'rentnerproxy-production-backup',
        postgres: {
            bytes: 3,
            database: 'rentnerproxy',
            dump: 'postgres.dump',
            sha256: sha256(emptyBytes),
            user: 'rentnerproxy',
        },
        redis: 'excluded',
        version: 3,
    }
}

function v4Metadata() {
    return {
        ...v3Metadata(),
        crowdSecState: {
            archive: 'crowdsec-state.tar',
            bytes: 3,
            sha256: sha256(emptyBytes),
        },
        deployment: {
            publicOrigin: 'https://management.example.test',
            trustedProxyCidrs: '10.0.0.0/8,127.0.0.1/32',
        },
        source: {
            imageId: 'sha256:' + 'b'.repeat(64),
            revision: '0123456789abcdef',
            version: 'v1.0.0',
        },
        version: 4,
    }
}

function octal(value: number, width: number): Uint8Array {
    const text = value.toString(8).padStart(width - 1, '0') + '\0'
    return Buffer.from(text, 'ascii')
}

function putText(header: Uint8Array, offset: number, width: number, value: string): void {
    const encoded = Buffer.from(value, 'utf8')
    header.set(encoded.subarray(0, width), offset)
}

type TarRecord = Readonly<{
    name: string
    bytes?: Uint8Array
    mode?: number
    type?: string
}>

function tarRecord(record: TarRecord): Uint8Array {
    const body = record.bytes ?? new Uint8Array()
    const header = new Uint8Array(512)
    putText(header, 0, 100, record.name)
    header.set(octal(record.mode ?? 0o600, 8), 100)
    header.set(octal(0, 8), 108)
    header.set(octal(0, 8), 116)
    header.set(octal(body.byteLength, 12), 124)
    header.set(octal(0, 12), 136)
    header.fill(0x20, 148, 156)
    header[156] = (record.type ?? '0').charCodeAt(0)
    putText(header, 257, 6, 'ustar\0')
    putText(header, 263, 2, '00')
    header.set(
        octal(
            header.reduce((sum, byte) => sum + byte, 0),
            8,
        ),
        148,
    )

    const paddedBody = new Uint8Array(Math.ceil(body.byteLength / 512) * 512)
    paddedBody.set(body)
    return Buffer.concat([header, paddedBody])
}

function archive(records: readonly TarRecord[], trailer = true): Uint8Array {
    const pieces = records.map(tarRecord)
    if (trailer) pieces.push(new Uint8Array(1024))
    return Buffer.concat(pieces)
}

function utf8(value: string): Uint8Array {
    return Buffer.from(value, 'utf8')
}

function expectArchiveError(
    input: Uint8Array,
    kind: 'controller' | 'crowdsec',
    message: RegExp,
): void {
    assert.throws(() => validateStateArchive(input, kind), message)
}

function certificateEntry(document: unknown): StateArchiveEntry {
    return {
        name: 'state/certificate-metadata.json',
        directory: false,
        bytes: utf8(JSON.stringify(document)),
    }
}

const deployment: DeploymentSettings = {
    publicOrigin: 'https://management.example.test',
    trustedProxyCidrs: '127.0.0.1/32, 10.0.0.0/8',
}

describe('production backup metadata', () => {
    it('accepts strict v3 and v4 metadata with valid artifact counts and digests', () => {
        assert.equal(parseBackupMetadata(v3Metadata()).version, 3)
        assert.equal(parseBackupMetadata(v4Metadata()).version, 4)
    })

    it('rejects unsupported versions and malformed or unexpected metadata', () => {
        for (const version of [1, 2, 5]) {
            assert.throws(
                () => parseBackupMetadata({ ...v3Metadata(), version }),
                /unsupported or invalid backup metadata/u,
            )
        }

        assert.throws(
            () => parseBackupMetadata({ ...v4Metadata(), unrecognized: true }),
            /unsupported or invalid backup metadata/u,
        )
        assert.throws(
            () =>
                parseBackupMetadata({
                    ...v4Metadata(),
                    postgres: { ...v4Metadata().postgres, bytes: 0 },
                }),
            /unsupported or invalid backup metadata/u,
        )
        assert.throws(
            () =>
                parseBackupMetadata({
                    ...v4Metadata(),
                    controllerState: { ...v4Metadata().controllerState, sha256: 'bad' },
                }),
            /unsupported or invalid backup metadata/u,
        )
        assert.throws(
            () =>
                parseBackupMetadata({
                    ...v4Metadata(),
                    crowdSecState: { ...v4Metadata().crowdSecState, bytes: 8 * 1024 ** 3 + 1 },
                }),
            /unsupported or invalid backup metadata/u,
        )
    })

    it('verifies artifact size and SHA-256 before accepting bytes', () => {
        const expected = { bytes: emptyBytes.byteLength, sha256: sha256(emptyBytes) }
        assert.doesNotThrow(() => verifyBackupArtifact(emptyBytes, expected, 'controller state'))
        assert.throws(
            () => verifyBackupArtifact(emptyBytes, { ...expected, bytes: 4 }, 'controller state'),
            /controller state checksum mismatch/u,
        )
        assert.throws(
            () =>
                verifyBackupArtifact(
                    emptyBytes,
                    { ...expected, sha256: '0'.repeat(64) },
                    'controller state',
                ),
            /controller state checksum mismatch/u,
        )
    })
})

describe('deployment compatibility', () => {
    it('requires review for legacy v3 and permits matching v4 deployment settings', () => {
        assert.throws(
            () => assertDeploymentCompatible(parseBackupMetadata(v3Metadata()), deployment, false),
            /deployment settings need review/u,
        )
        assert.doesNotThrow(() =>
            assertDeploymentCompatible(parseBackupMetadata(v3Metadata()), deployment, true),
        )
        assert.doesNotThrow(() =>
            assertDeploymentCompatible(parseBackupMetadata(v4Metadata()), deployment, false),
        )
    })

    it('requires explicit override for origin or trusted proxy changes', () => {
        const metadata = parseBackupMetadata(v4Metadata())
        const changedOrigin = { ...deployment, publicOrigin: 'https://other.example.test' }
        const changedCidrs = { ...deployment, trustedProxyCidrs: '192.0.2.0/24' }

        assert.throws(
            () => assertDeploymentCompatible(metadata, changedOrigin, false),
            /deployment settings need review/u,
        )
        assert.throws(
            () => assertDeploymentCompatible(metadata, changedCidrs, false),
            /deployment settings need review/u,
        )
        assert.doesNotThrow(() => assertDeploymentCompatible(metadata, changedOrigin, true))
        assert.doesNotThrow(() => assertDeploymentCompatible(metadata, changedCidrs, true))
    })

    it('compares trusted proxy CIDRs independent of order and whitespace', () => {
        const metadata = parseBackupMetadata(v4Metadata())
        assert.doesNotThrow(() =>
            assertDeploymentCompatible(
                metadata,
                { ...deployment, trustedProxyCidrs: ' 127.0.0.1/32 ,10.0.0.0/8 ' },
                false,
            ),
        )
    })
})

describe('controller state archive validation', () => {
    it('accepts regular USTAR entries and GNU long-name records', () => {
        const longName = 'certificates/' + 'x'.repeat(180) + '/certificate-metadata.json'
        const input = archive([
            { name: 'state/config.json', bytes: utf8('{}') },
            { name: '././@LongLink', type: 'L', bytes: utf8(longName + '\0') },
            { name: 'short-name', bytes: utf8('metadata') },
        ])

        const entries = validateStateArchive(input, 'controller')
        assert.deepEqual(
            entries.map((entry) => entry.name),
            ['state/config.json', longName],
        )
        assert.equal(Buffer.from(entries[1]!.bytes).toString('utf8'), 'metadata')
    })

    it('rejects symlinks, hard links, devices, FIFOs and unsafe permission bits', () => {
        for (const type of ['1', '2', '3', '4', '6']) {
            expectArchiveError(
                archive([{ name: 'state/link', type }]),
                'controller',
                /unsupported state archive entry/u,
            )
        }
        expectArchiveError(
            archive([{ name: 'state/config', mode: 0o4755, bytes: utf8('x') }]),
            'controller',
            /unsafe state archive permissions/u,
        )
    })

    it('rejects absolute, traversal, backslash and control-character paths', () => {
        for (const name of [
            '/etc/passwd',
            '../outside',
            'state/../../outside',
            '..\\outside',
            'C:/outside',
            'state/line\u001bfeed',
        ]) {
            expectArchiveError(
                archive([{ name, bytes: utf8('x') }]),
                'controller',
                /unsafe state archive path/u,
            )
        }
    })

    it('rejects duplicate names and file-directory path conflicts', () => {
        expectArchiveError(
            archive([
                { name: 'state/config', bytes: utf8('a') },
                { name: 'state/config', bytes: utf8('b') },
            ]),
            'controller',
            /duplicate or invalid state archive entry/u,
        )
        expectArchiveError(
            archive([
                { name: 'state', bytes: utf8('file') },
                { name: 'state/child', bytes: utf8('x') },
            ]),
            'controller',
            /conflicting state archive paths/u,
        )
        expectArchiveError(
            archive([
                { name: 'state/child', bytes: utf8('x') },
                { name: 'state', bytes: utf8('file') },
            ]),
            'controller',
            /conflicting state archive paths/u,
        )
    })

    it('rejects truncation, invalid header checksums and nonzero data after EOF', () => {
        const valid = archive([{ name: 'state/config', bytes: utf8('x') }])
        expectArchiveError(
            valid.subarray(0, valid.byteLength - 512),
            'controller',
            /invalid state archive trailer/u,
        )

        const badChecksum = Uint8Array.from(valid)
        badChecksum[0] = badChecksum[0]! ^ 1
        expectArchiveError(badChecksum, 'controller', /invalid state archive checksum/u)

        const withExtraEntry = Buffer.concat([
            valid,
            tarRecord({ name: 'after-eof', bytes: utf8('x') }),
        ])
        expectArchiveError(withExtraEntry, 'controller', /invalid state archive trailer/u)

        const truncatedBody = Buffer.concat([
            tarRecord({ name: 'state/large', bytes: new Uint8Array(1024) }).subarray(0, 1024),
        ])
        expectArchiveError(truncatedBody, 'controller', /truncated state archive/u)
    })

    it('rejects missing trailers and archives without entries', () => {
        expectArchiveError(
            archive([{ name: 'state/config', bytes: utf8('x') }], false),
            'controller',
            /missing state archive trailer/u,
        )
        expectArchiveError(new Uint8Array(1024), 'controller', /empty state archive/u)
    })
})

describe('CrowdSec state archive validation', () => {
    it('accepts an empty state archive and a complete database bundle with credentials', () => {
        const empty = archive([{ name: 'data', type: '5' }])
        assert.equal(validateStateArchive(empty, 'crowdsec').length, 1)

        const validDatabase = archive([
            { name: 'data', type: '5' },
            { name: 'credentials', type: '5' },
            { name: 'bouncer', type: '5' },
            { name: 'data/crowdsec.db', bytes: utf8('SQLite format 3\0') },
            { name: 'credentials/local_api_credentials.yaml', bytes: utf8('login: fixture\n') },
            { name: 'bouncer/caddy-bouncer-key', bytes: utf8('fixture-key') },
        ])
        const entries = validateStateArchive(validDatabase, 'crowdsec')
        assert.ok(entries.some((entry) => entry.name === 'data/crowdsec.db'))
    })

    it('rejects CrowdSec paths outside its allowlist and incomplete database bundles', () => {
        expectArchiveError(
            archive([{ name: 'data/other.db', bytes: utf8('fixture') }]),
            'crowdsec',
            /unsupported CrowdSec state archive path/u,
        )
        expectArchiveError(
            archive([{ name: 'data/crowdsec.db', bytes: utf8('SQLite format 3\0') }]),
            'crowdsec',
            /incomplete CrowdSec state archive/u,
        )
        expectArchiveError(
            archive([
                { name: 'credentials/local_api_credentials.yaml', bytes: new Uint8Array(65_537) },
            ]),
            'crowdsec',
            /invalid CrowdSec credential size/u,
        )
    })

    it('checks SQLite file signatures for CrowdSec databases', () => {
        expectArchiveError(
            archive([
                { name: 'data/crowdsec.db', bytes: utf8('not sqlite') },
                { name: 'credentials/local_api_credentials.yaml', bytes: utf8('login: x') },
                { name: 'bouncer/caddy-bouncer-key', bytes: utf8('key') },
            ]),
            'crowdsec',
            /invalid CrowdSec database/u,
        )
    })
})

describe('encrypted controller certificate state', () => {
    it('requires referenced certificate material for flattened controller records', () => {
        const materialId = 'a'.repeat(64)
        const metadata = certificateEntry({ id: 'certificate-id', materialId })
        const fullchain = {
            name: 'certificates/certificate-id/versions/' + materialId + '/fullchain.pem',
            directory: false,
            bytes: utf8('fixture certificate'),
        }
        const privateKey = {
            name: 'certificates/certificate-id/versions/' + materialId + '/private-key.pem',
            directory: false,
            bytes: utf8('fixture key'),
        }
        expect(() => validateControllerEncryption([metadata, fullchain], () => undefined)).toThrow(
            'incomplete certificate material',
        )
        expect(() =>
            validateControllerEncryption([metadata, fullchain, privateKey], () => undefined),
        ).not.toThrow()
    })

    it('checks active, pending and candidate DNS credential metadata through the decrypt callback', () => {
        const records = [
            ['active/certificate-metadata.json', 'active-id'],
            ['pending/certificate-metadata.json', 'pending-id'],
            ['candidate.json', 'candidate-id'],
        ] as const
        const entries: StateArchiveEntry[] = records.map(([name, id]) => ({
            name,
            directory: false,
            bytes: utf8(
                JSON.stringify({
                    metadata: { id },
                    acme: {
                        dnsProvider: {
                            ciphertext: [11, 12],
                            nonce: [13, 14],
                            version: 1,
                        },
                    },
                }),
            ),
        }))
        const calls: { ciphertext: number[]; iv: number[]; context: string }[] = []

        validateControllerEncryption(entries, (ciphertext, iv, context) => {
            calls.push({ ciphertext: [...ciphertext], iv: [...iv], context })
        })

        assert.deepEqual(calls, [
            { ciphertext: [11, 12], iv: [13, 14], context: 'active-id' },
            { ciphertext: [11, 12], iv: [13, 14], context: 'pending-id' },
            { ciphertext: [11, 12], iv: [13, 14], context: 'candidate-id' },
        ])
    })

    it('rejects invalid metadata, nonce bytes and decrypt failures', () => {
        const valid = {
            metadata: { id: 'certificate-id' },
            acme: { dnsProvider: { ciphertext: [1], nonce: [2], version: 1 } },
        }

        assert.throws(
            () =>
                validateControllerEncryption(
                    [{ ...certificateEntry(null), bytes: utf8('{broken') }],
                    () => undefined,
                ),
            /invalid certificate state metadata/u,
        )
        assert.throws(
            () =>
                validateControllerEncryption(
                    [
                        certificateEntry({
                            ...valid,
                            acme: { dnsProvider: { ...valid.acme.dnsProvider, nonce: [256] } },
                        }),
                    ],
                    () => undefined,
                ),
            /invalid encrypted certificate state/u,
        )
        assert.throws(
            () =>
                validateControllerEncryption([certificateEntry(valid)], () => {
                    throw new Error('decrypt failed')
                }),
            /decrypt failed/u,
        )
    })
})
