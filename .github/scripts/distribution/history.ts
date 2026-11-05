// oxlint-disable no-await-in-loop -- Verify the complete immutable history before renewing public indexes.
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bundleFiles, distributionFileHash } from './bundle.ts'
import { distributionCommand } from './process.ts'
import { signingFingerprint } from './repository.ts'
import { ociRecord } from '../lib/oci-layout.ts'
import { maximumRepositoryFiles } from './limits.ts'

async function immutableFiles(root: string) {
    const files = ['catalog.json', 'catalog.json.asc']
    for (const prefix of ['keys', 'releases', 'deliverables']) {
        const info = await lstat(join(root, prefix)).catch((error) => {
            if (error.code === 'ENOENT') return null
            throw error
        })
        if (!info) continue
        if (!info.isDirectory()) throw new Error('Invalid immutable repository directory')
        files.push(...(await bundleFiles(join(root, prefix), prefix + '/', maximumRepositoryFiles)))
    }
    if (files.length > maximumRepositoryFiles) throw new Error('Immutable repository is too large')
    return files.toSorted()
}

export async function writeImmutableRepositoryManifest(
    root: string,
    home: string,
    fingerprint: string,
) {
    signingFingerprint(fingerprint)
    const files = []
    for (const file of await immutableFiles(root)) {
        const path = join(root, file),
            sha256 = await distributionFileHash(path),
            info = await lstat(path)
        files.push({ file, sha256, bytes: info.size })
    }
    const manifest = JSON.stringify({ schemaVersion: 1, files }) + '\n'
    if (Buffer.byteLength(manifest) > 16 * 1024 * 1024)
        throw new Error('Immutable manifest is too large')
    const path = join(root, 'immutable-files.json')
    await writeFile(path, manifest)
    await distributionCommand([
        'gpg',
        '--homedir',
        home,
        '--batch',
        '--yes',
        '--local-user',
        fingerprint,
        '--armor',
        '--detach-sign',
        path,
    ])
}

export async function verifyImmutableRepositoryManifest(root: string, home: string) {
    const path = join(root, 'immutable-files.json')
    await distributionFileHash(path)
    await distributionCommand([
        'gpg',
        '--homedir',
        home,
        '--batch',
        '--no-auto-key-retrieve',
        '--verify',
        path + '.asc',
        path,
    ])
    const manifest = ociRecord(JSON.parse(await readFile(path, 'utf8'))),
        files = await immutableFiles(root)
    if (
        manifest.schemaVersion !== 1 ||
        !Array.isArray(manifest.files) ||
        manifest.files.length !== files.length
    )
        throw new Error('Immutable repository manifest does not cover its complete history')
    for (const [index, file] of files.entries()) {
        const entry = ociRecord(manifest.files[index]),
            target = join(root, file),
            sha256 = await distributionFileHash(target),
            info = await lstat(target)
        if (entry.file !== file || entry.sha256 !== sha256 || entry.bytes !== info.size)
            throw new Error('Immutable repository file checksum or coverage mismatch')
    }
}
