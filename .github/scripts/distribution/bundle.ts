// oxlint-disable no-await-in-loop -- Verify bounded artifact files without executing them.
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ociRecord } from '../lib/oci-layout.ts'

export async function bundleFiles(directory: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        if (!/^[A-Za-z0-9_.-]+$/u.test(entry.name) || entry.name === '.' || entry.name === '..')
            throw new Error('Invalid artifact path')
        const path = prefix + entry.name
        if (entry.isDirectory())
            files.push(...(await bundleFiles(join(directory, entry.name), path + '/')))
        else if (entry.isFile()) files.push(path)
        else throw new Error('Artifact links are forbidden')
        if (files.length > 4096) throw new Error('Artifact bundle is too large')
    }
    return files.toSorted()
}

export async function distributionFileHash(path: string): Promise<string> {
    const info = await lstat(path)
    if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 * 1024)
        throw new Error('Invalid distribution artifact file')
    return createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
}

export async function writeDistributionBundle(
    root: string,
    identity: {
        revision: string
        version: string
        digest: string
        runId: string
        runAttempt: number
    },
): Promise<string> {
    const files = await bundleFiles(root)
    const manifest = {
        schemaVersion: 1,
        ...identity,
        files: await Promise.all(
            files.map(async (file) => ({
                file,
                sha256: await distributionFileHash(join(root, file)),
            })),
        ),
    }
    await writeFile(join(root, 'bundle.json'), JSON.stringify(manifest) + '\n', { flag: 'wx' })
    return distributionFileHash(join(root, 'bundle.json'))
}

export async function verifyDistributionBundle(
    root: string,
    expectedHash: string,
    identity: {
        revision: string
        version: string
        digest: string
        runId: string
        runAttempt: number
    },
): Promise<void> {
    if (
        !/^[a-f0-9]{64}$/u.test(expectedHash) ||
        (await distributionFileHash(join(root, 'bundle.json'))) !== expectedHash
    )
        throw new Error('Distribution producer checksum mismatch')
    const manifest = ociRecord(JSON.parse(await readFile(join(root, 'bundle.json'), 'utf8')))
    if (
        manifest.schemaVersion !== 1 ||
        Object.entries(identity).some(
            ([key, value]) => key !== 'runAttempt' && manifest[key] !== value,
        ) ||
        typeof manifest.runAttempt !== 'number' ||
        !Number.isSafeInteger(manifest.runAttempt) ||
        manifest.runAttempt < 1 ||
        manifest.runAttempt > identity.runAttempt ||
        !Array.isArray(manifest.files)
    )
        throw new Error('Distribution proof identity mismatch')
    const paths = (await bundleFiles(root)).filter((file) => file !== 'bundle.json')
    if (manifest.files.length !== paths.length)
        throw new Error('Unexpected distribution bundle files')
    for (const [index, path] of paths.entries()) {
        const file = ociRecord(manifest.files[index])
        if (file.file !== path || (await distributionFileHash(join(root, path))) !== file.sha256)
            throw new Error('Distribution artifact was substituted')
    }
}
