// oxlint-disable no-await-in-loop -- Build identity hashes a stable ordered set of immutable runtime files.
import { createHash } from 'node:crypto'
import { open, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { managedBackupSourceSchema } from '../../../web/src/lib/Backups/validation.ts'

async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const paths = await Promise.all(
        entries.map(async (entry) => {
            const path = join(directory, entry.name)
            if (entry.isDirectory()) return files(path)
            if (!entry.isFile()) throw new Error('invalid build identity input')
            return [path]
        }),
    )
    return paths.flat().toSorted()
}

const root = '/opt/rentnerproxy/web'
const hash = createHash('sha256')
for (const path of [
    '/usr/local/bin/rentnerproxy-controller',
    '/usr/local/bin/rentnerproxy-production',
    '/usr/local/lib/rentnerproxy-backups.sh',
    root + '/backup-agent.js',
    root + '/backup-export.js',
    root + '/migrate.js',
    ...(await files(root + '/web/dist')),
    ...(await files(root + '/web/drizzle')),
]) {
    hash.update(relative('/', path) + '\0')
    const file = await open(path, 'r')
    try {
        const digest = createHash('sha256')
        for await (const bytes of file.createReadStream({ autoClose: false })) digest.update(bytes)
        hash.update(digest.digest())
    } finally {
        await file.close()
    }
}
const source = managedBackupSourceSchema.parse({
    imageId: null,
    revision: process.env.RENTNERPROXY_BUILD_REVISION || null,
    version: process.env.RENTNERPROXY_BUILD_VERSION || 'development',
    buildSha256: hash.digest('hex'),
})
await writeFile('/usr/share/rentnerproxy/backup-source.json', JSON.stringify(source) + '\n', {
    mode: 0o444,
    flag: 'wx',
})
