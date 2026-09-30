import { createHash } from 'node:crypto'
import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const artifact = z.strictObject({
    bytes: z
        .number()
        .int()
        .positive()
        .max(8 * 1024 ** 3),
    sha256: digest,
})
const database = artifact.extend({
    database: z.literal('rentnerproxy'),
    dump: z.literal('postgres.dump'),
    user: z.literal('rentnerproxy'),
})
const key = artifact.extend({ file: z.literal('app-encryption-key') })
const controller = artifact.extend({ archive: z.literal('controller-state.tar') })
const base = {
    applicationEncryptionKey: key,
    controllerState: controller,
    createdAt: z.iso.datetime(),
    format: z.literal('rentnerproxy-production-backup'),
    postgres: database,
    redis: z.literal('excluded'),
}
export const deploymentSchema = z.strictObject({
    publicOrigin: z.string().url().max(4096),
    trustedProxyCidrs: z.string().max(8192),
})
const metadataSchema = z.discriminatedUnion('version', [
    z.strictObject({ ...base, version: z.literal(3) }),
    z.strictObject({
        ...base,
        version: z.literal(4),
        crowdSecState: artifact.extend({ archive: z.literal('crowdsec-state.tar') }),
        deployment: deploymentSchema,
        source: z.strictObject({
            imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            revision: z.string().max(128).nullable(),
            version: z.string().max(128).nullable(),
        }),
    }),
])
export type BackupMetadata = z.infer<typeof metadataSchema>
export type DeploymentSettings = z.infer<typeof deploymentSchema>

export function parseBackupMetadata(value: unknown): BackupMetadata {
    const result = metadataSchema.safeParse(value)
    if (!result.success)
        throw new Error('unsupported or invalid backup metadata (supported: v3, v4)')
    return result.data
}

export function verifyBackupArtifact(
    bytes: Uint8Array,
    metadata: { bytes: number; sha256: string },
    label: string,
): void {
    if (
        bytes.byteLength !== metadata.bytes ||
        createHash('sha256').update(bytes).digest('hex') !== metadata.sha256
    )
        throw new Error(label + ' checksum mismatch')
}

function canonicalCidrs(value: string): string {
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .toSorted()
        .join(',')
}

export function assertDeploymentCompatible(
    metadata: BackupMetadata,
    target: DeploymentSettings,
    allowChange: boolean,
): void {
    if (
        !allowChange &&
        (metadata.version === 3 ||
            metadata.deployment.publicOrigin !== target.publicOrigin ||
            canonicalCidrs(metadata.deployment.trustedProxyCidrs) !==
                canonicalCidrs(target.trustedProxyCidrs))
    ) {
        throw new Error(
            'deployment settings need review; preserve the original origin, trusted proxy CIDRs and Compose environment, or use --allow-deployment-change',
        )
    }
}

export const crowdSecArchiveExclusions = ['./data/crowdsec.db-shm']
const crowdSecFiles = new Set([
    'data/crowdsec.db',
    'data/crowdsec.db-wal',
    'credentials/local_api_credentials.yaml',
    'credentials/online_api_credentials.yaml',
    'credentials/console.yaml',
    'bouncer/caddy-bouncer-key',
])
export type StateArchiveEntry = Readonly<{
    name: string
    directory: boolean
    bytes: Uint8Array
}>

function tarString(bytes: Uint8Array): string {
    const end = bytes.indexOf(0)
    return new TextDecoder('utf-8', { fatal: true }).decode(
        end < 0 ? bytes : bytes.subarray(0, end),
    )
}

function tarNumber(bytes: Uint8Array): number {
    const value = tarString(bytes).trim()
    if (!/^[0-7]+$/u.test(value)) throw new Error('invalid state archive header')
    const number = Number.parseInt(value, 8)
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('invalid state archive size')
    return number
}

function safeName(value: string): string {
    if (
        value.length > 4096 ||
        value.includes('\\') ||
        [...value].some((char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127) ||
        value.startsWith('/') ||
        /^[A-Za-z]:/u.test(value)
    ) {
        throw new Error('unsafe state archive path')
    }
    const parts = value.split('/').filter((part) => part !== '' && part !== '.')
    if (parts.includes('..')) throw new Error('unsafe state archive path')
    return parts.join('/')
}

export function validateStateArchive(
    archive: Uint8Array,
    kind: 'controller' | 'crowdsec',
): StateArchiveEntry[] {
    if (archive.byteLength < 1024 || archive.byteLength % 512 !== 0)
        throw new Error('invalid state archive')
    const entries: StateArchiveEntry[] = []
    const names = new Map<string, boolean>()
    let offset = 0
    let longName: string | null = null
    while (offset + 512 <= archive.byteLength) {
        const header = archive.subarray(offset, offset + 512)
        if (header.every((byte) => byte === 0)) {
            if (
                longName !== null ||
                offset + 1024 > archive.byteLength ||
                archive.subarray(offset).some((byte) => byte !== 0)
            )
                throw new Error('invalid state archive trailer')
            if (entries.length === 0) throw new Error('empty state archive')
            if (kind === 'crowdsec' && names.has('data/crowdsec.db')) {
                for (const name of [
                    'credentials/local_api_credentials.yaml',
                    'bouncer/caddy-bouncer-key',
                ]) {
                    if (!names.has(name) || names.get(name))
                        throw new Error('incomplete CrowdSec state archive')
                }
                const db = entries.find((entry) => entry.name === 'data/crowdsec.db')!
                if (
                    Buffer.from(db.bytes.subarray(0, 16)).toString('utf8') !== 'SQLite format 3\0'
                ) {
                    throw new Error('invalid CrowdSec database')
                }
            }
            return entries
        }
        const checksum = header.reduce(
            (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
            0,
        )
        if (checksum !== tarNumber(header.subarray(148, 156)))
            throw new Error('invalid state archive checksum')
        const size = tarNumber(header.subarray(124, 136))
        const mode = tarNumber(header.subarray(100, 108))
        if ((mode & 0o7000) !== 0) throw new Error('unsafe state archive permissions')
        const type = header[156]
        const bodyOffset = offset + 512
        offset = bodyOffset + Math.ceil(size / 512) * 512
        if (offset > archive.byteLength) throw new Error('truncated state archive')
        const bytes = archive.subarray(bodyOffset, bodyOffset + size)
        if (type === 76) {
            if (longName !== null || size > 4097) throw new Error('invalid long state archive path')
            longName = tarString(bytes)
            continue
        }
        if (type !== 0 && type !== 48 && type !== 53)
            throw new Error('unsupported state archive entry')
        const directory = type === 53
        if (directory && size !== 0) throw new Error('invalid state archive directory')
        const prefix =
            tarString(header.subarray(257, 263)) === 'ustar' && header[262] === 0
                ? tarString(header.subarray(345, 500))
                : ''
        const shortName = tarString(header.subarray(0, 100))
        const name = safeName(longName ?? (prefix ? prefix + '/' + shortName : shortName))
        longName = null
        if ((!name && !directory) || names.has(name))
            throw new Error('duplicate or invalid state archive entry')
        const parts = name.split('/')
        for (let index = 1; index < parts.length; index += 1) {
            if (names.get(parts.slice(0, index).join('/')) === false)
                throw new Error('conflicting state archive paths')
        }
        if (!directory && [...names.keys()].some((entry) => entry.startsWith(name + '/'))) {
            throw new Error('conflicting state archive paths')
        }
        if (
            kind === 'crowdsec' &&
            !(directory
                ? ['', 'data', 'credentials', 'bouncer'].includes(name)
                : crowdSecFiles.has(name))
        )
            throw new Error('unsupported CrowdSec state archive path')
        if (
            kind === 'crowdsec' &&
            !directory &&
            name !== 'data/crowdsec.db' &&
            name !== 'data/crowdsec.db-wal' &&
            size > 65_536
        ) {
            throw new Error('invalid CrowdSec credential size')
        }
        names.set(name, directory)
        entries.push({ name, directory, bytes })
        if (entries.length > 200_000) throw new Error('too many state archive entries')
    }
    throw new Error('missing state archive trailer')
}

export function validateControllerEncryption(
    entries: StateArchiveEntry[],
    decrypt: (ciphertext: Uint8Array, iv: Uint8Array, context: string) => void,
): void {
    const files = new Map(
        entries.filter((entry) => !entry.directory).map((entry) => [entry.name, entry.bytes]),
    )
    for (const entry of entries) {
        if (
            entry.directory ||
            !/(?:^|\/)(?:certificate-metadata|candidate)\.json$/u.test(entry.name)
        )
            continue
        let document: unknown
        try {
            document = JSON.parse(Buffer.from(entry.bytes).toString('utf8'))
        } catch {
            throw new Error('invalid certificate state metadata')
        }
        const visit = (value: unknown): void => {
            if (!value || typeof value !== 'object') return
            const object = value as Record<string, unknown>
            const metadata = object.metadata as { id?: unknown } | undefined
            const certificateId = object.id ?? metadata?.id
            const acme = object.acme as
                | { dnsProvider?: { ciphertext?: unknown; nonce?: unknown; version?: unknown } }
                | undefined
            if (object.materialId != null) {
                if (
                    typeof certificateId !== 'string' ||
                    typeof object.materialId !== 'string' ||
                    !/^[a-f0-9]{64}$/u.test(object.materialId)
                )
                    throw new Error('invalid certificate material reference')
                for (const name of ['fullchain.pem', 'private-key.pem']) {
                    const file = files.get(
                        'certificates/' +
                            certificateId +
                            '/versions/' +
                            object.materialId +
                            '/' +
                            name,
                    )
                    if (!file || file.length === 0)
                        throw new Error('incomplete certificate material in backup')
                }
            }
            const provider = acme?.dnsProvider
            if (provider) {
                if (
                    typeof certificateId !== 'string' ||
                    provider.version !== 1 ||
                    !Array.isArray(provider.ciphertext) ||
                    !Array.isArray(provider.nonce) ||
                    [...provider.ciphertext, ...provider.nonce].some(
                        (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255,
                    )
                ) {
                    throw new Error('invalid encrypted certificate state')
                }
                decrypt(
                    new Uint8Array(provider.ciphertext),
                    new Uint8Array(provider.nonce),
                    certificateId,
                )
            }
            for (const child of Object.values(object)) visit(child)
        }
        visit(document)
    }
}
