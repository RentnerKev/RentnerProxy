// oxlint-disable no-await-in-loop -- Validate bounded immutable inputs before writing their presentation copy.
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { bundleFiles, distributionFileHash } from './bundle.ts'
import { packageTar } from './archive.ts'
import { distributionPackageVersion, parseDistributionRelease } from './release.ts'
import { ociRecord } from '../lib/oci-layout.ts'

const maximumArchiveBytes = 16 * 1024 * 1024
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export function verificationArchiveName(tag: string): string {
    distributionPackageVersion(tag)
    return `RentnerProxy-${tag}-verification.tar.gz`
}

function flatName(name: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u.test(name))
        throw new Error('Invalid flat verification archive path')
}

function validateOriginals(files: ReadonlyMap<string, Buffer>, tag: string) {
    distributionPackageVersion(tag)
    for (const name of files.keys()) flatName(name)
    const statement = ociRecord(
        JSON.parse(files.get('distribution.intoto.json')?.toString() ?? 'null'),
    )
    const parameters = ociRecord(
        ociRecord(ociRecord(statement.predicate).buildDefinition).externalParameters,
    )
    if (
        statement['_type'] !== 'https://in-toto.io/Statement/v1' ||
        statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
        parameters.version !== tag ||
        !Array.isArray(statement.subject) ||
        !files.get('distribution.intoto.json.asc')?.length
    )
        throw new Error('Invalid original distribution provenance')
    const subjects = new Map<string, string>()
    for (const raw of statement.subject) {
        const subject = ociRecord(raw)
        if (typeof subject.name !== 'string' || subjects.has(subject.name))
            throw new Error('Duplicate or invalid distribution subject')
        subjects.set(subject.name, String(ociRecord(subject.digest).sha256))
    }
    if (subjects.size !== files.size - 2)
        throw new Error('Incomplete original distribution subjects')
    for (const [name, bytes] of files) {
        if (name === 'distribution.intoto.json' || name === 'distribution.intoto.json.asc') continue
        if (subjects.get(name) !== hash(bytes))
            throw new Error('Original distribution subject checksum mismatch')
    }
    const installers: string[] = []
    for (const name of [
        'MAINTAINER.txt',
        'assessed-image-evidence.json',
        ...['debian', 'fedora'].flatMap((target) =>
            ['amd64', 'arm64'].map((architecture) => `native-${target}-${architecture}.json`),
        ),
    ])
        if (!files.get(name)?.length) throw new Error('Missing original distribution evidence')
    if ([...files.keys()].filter((name) => /^[A-F0-9]{40}\.asc$/u.test(name)).length !== 1)
        throw new Error('Missing original public signing key')
    let packageRevision: number | undefined
    for (const architecture of ['amd64', 'arm64'] as const) {
        const prefix = `rentnerproxy-${tag}-${architecture}`
        const entry = ociRecord(
            JSON.parse(files.get(prefix + '-release.json')?.toString() ?? 'null'),
        )
        const release = parseDistributionRelease(entry.release)
        if (
            release.version !== tag ||
            release.platform !== 'linux/' + architecture ||
            release.revision !== parameters.revision ||
            release.digest !== parameters.digest ||
            (packageRevision !== undefined && packageRevision !== release.packageRevision)
        )
            throw new Error('Distribution metadata identity mismatch')
        packageRevision = release.packageRevision
        const stem = `rentnerproxy-${tag.slice(1)}-${packageRevision}-${architecture}`
        for (const suffix of ['.deb', '.rpm', '-quadlet.tar.gz']) {
            const name = stem + suffix
            if (!files.get(name)?.length) throw new Error('Missing original installer')
            installers.push(name)
        }
        for (const suffix of [
            '-SHA256SUMS',
            '-SHA256SUMS.asc',
            '-release.json.asc',
            '-INSTALL.txt',
            '.spdx.json',
        ])
            if (!files.get(prefix + suffix)?.length)
                throw new Error('Missing original verification metadata')
    }
    if ([...files.keys()].filter((name) => /\.(?:deb|rpm|tar\.gz)$/u.test(name)).length !== 6)
        throw new Error('Unexpected original installers')
    const guide = files.get(`rentnerproxy-${tag}-amd64-INSTALL.txt`)!
    if (!guide.equals(files.get(`rentnerproxy-${tag}-arm64-INSTALL.txt`)!))
        throw new Error('Architecture installation instructions differ')
    return { installers: installers.toSorted(), statement, guide, packageRevision }
}

function archive(files: ReadonlyMap<string, Buffer>): Buffer {
    const chunks: Buffer[] = []
    for (const [name, bytes] of [...files].toSorted(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    )) {
        flatName(name)
        if (bytes.length > 4 * 1024 * 1024)
            throw new Error('Verification metadata file is too large')
        const header = Buffer.alloc(512)
        header.write(name)
        const octal = (offset: number, width: number, value: number) =>
            header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii')
        octal(100, 8, 0o644)
        octal(108, 8, 0)
        octal(116, 8, 0)
        octal(124, 12, bytes.length)
        octal(136, 12, 0)
        header.fill(32, 148, 156)
        header.write('0', 156)
        header.write('ustar\0', 257)
        header.write('00', 263)
        const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
        chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
    }
    const tar = Buffer.concat([...chunks, Buffer.alloc(1024)])
    if (tar.length > maximumArchiveBytes) throw new Error('Verification archive is too large')
    const compressed = gzipSync(tar, { level: 9 })
    compressed[9] = 255
    return compressed
}

export function readVerificationArchive(bytes: Uint8Array): Map<string, Buffer> {
    if (bytes.length > maximumArchiveBytes) throw new Error('Verification archive is too large')
    const entries = packageTar(gunzipSync(bytes, { maxOutputLength: maximumArchiveBytes }))
    const files = new Map<string, Buffer>()
    if (entries.length > 128) throw new Error('Too many verification archive files')
    for (const entry of entries) {
        flatName(entry.path)
        if (
            entry.directory ||
            entry.mode !== 0o644 ||
            files.has(entry.path) ||
            /\.(?:deb|rpm|tar\.gz)$/u.test(entry.path)
        )
            throw new Error('Invalid verification archive entry')
        files.set(entry.path, entry.content)
    }
    return files
}

function friendlyInstructions(original: Buffer, tag: string, packageRevision: number): Buffer {
    return Buffer.from(
        original.toString('utf8') +
            `
Direct-download verification (${tag}):
Download ${verificationArchiveName(tag)} and your chosen installers into the same empty folder.
Extract the archive there; its flat files preserve the original signed metadata verbatim.
The archive container and this convenience guide are not separately OpenPGP-signed.
Check the complete public-key fingerprint independently before importing its .asc file.
Verify distribution.intoto.json.asc against distribution.intoto.json with that trusted key;
its original subjects bind all six external installers and the archived metadata by SHA-256.
For one architecture, download all three matching DEB/RPM/Quadlet files, verify
rentnerproxy-${tag}-ARCH-SHA256SUMS.asc against rentnerproxy-${tag}-ARCH-SHA256SUMS,
then run: sha256sum --check rentnerproxy-${tag}-ARCH-SHA256SUMS
Replace ARCH with amd64 or arm64. Do not skip missing files or signature failures.
The unchanged per-architecture metadata is also available at:
https://rentnerkev.github.io/RentnerProxy/releases/${tag}/${packageRevision}/ARCH/
`,
    )
}

export async function prepareCompactReleaseAssets(
    source: string,
    destination: string,
    tag: string,
): Promise<string[]> {
    const sourcePath = resolve(source),
        destinationPath = resolve(destination)
    for (const [parent, child] of [
        [sourcePath, destinationPath],
        [destinationPath, sourcePath],
    ]) {
        const path = relative(parent!, child!)
        if (!path || (path !== '..' && !path.startsWith('..' + sep)))
            throw new Error('Compact assets require separate source and destination directories')
    }
    const original = new Map<string, Buffer>()
    let total = 0
    for (const name of await bundleFiles(sourcePath, '', 128)) {
        flatName(name)
        await distributionFileHash(join(sourcePath, name))
        const bytes = await readFile(join(sourcePath, name))
        total += bytes.length
        if (total > 128 * 1024 * 1024) throw new Error('Original release assets are too large')
        original.set(name, bytes)
    }
    const validated = validateOriginals(original, tag)
    const metadata = new Map([...original].filter(([name]) => !validated.installers.includes(name)))
    const archiveBytes = archive(metadata)
    const output = new Map(validated.installers.map((name) => [name, original.get(name)!]))
    output.set(
        'INSTALL.txt',
        friendlyInstructions(validated.guide, tag, validated.packageRevision!),
    )
    output.set(verificationArchiveName(tag), archiveBytes)
    await mkdir(destinationPath, { recursive: true })
    for (const name of await readdir(destinationPath))
        if (!output.has(name)) throw new Error('Unexpected compact release output')
    for (const [name, bytes] of output) {
        const path = join(destinationPath, name)
        const info = await lstat(path).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            return null
        })
        if (info && (!info.isFile() || info.nlink !== 1))
            throw new Error('Invalid compact output file')
        const existing = await readFile(path).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            return null
        })
        if (existing && !existing.equals(bytes))
            throw new Error('Immutable compact release asset collision')
    }
    for (const [name, bytes] of output)
        await writeFile(join(destinationPath, name), bytes, { flag: 'wx' }).catch(
            (error: unknown) => {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            },
        )
    for (const [name, bytes] of output)
        if ((await distributionFileHash(join(destinationPath, name))) !== hash(bytes))
            throw new Error('Immutable compact release asset collision')
    return [...output.keys()].toSorted()
}

export async function verifyCompactReleaseAssets(directory: string, tag: string) {
    await distributionFileHash(join(directory, verificationArchiveName(tag)))
    const archived = readVerificationArchive(
        await readFile(join(directory, verificationArchiveName(tag))),
    )
    const original = new Map(archived)
    const installers = (await bundleFiles(directory)).filter(
        (name) => /\.(?:deb|rpm|tar\.gz)$/u.test(name) && name !== verificationArchiveName(tag),
    )
    for (const name of installers) {
        await distributionFileHash(join(directory, name))
        original.set(name, await readFile(join(directory, name)))
    }
    const validated = validateOriginals(original, tag)
    if (validated.installers.length !== installers.length)
        throw new Error('Incomplete compact installers')
    return {
        installers: validated.installers,
        archived: [...archived.keys()].toSorted(),
        statement: validated.statement,
    }
}

if (import.meta.main) {
    const [action, source, destination, tag] = process.argv.slice(2)
    if (action === 'prepare' && source && destination && tag)
        await prepareCompactReleaseAssets(source, destination, tag)
    else if (action === 'verify' && source && destination)
        await verifyCompactReleaseAssets(source, destination)
    else throw new Error('Expected prepare SOURCE DESTINATION TAG or verify DIRECTORY TAG')
}
