import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { syncBackupDirectory } from '../../../scripts/backup/publication.ts'

export const backupRoot = '/var/lib/rentnerproxy/backups'
export const artifactsRoot = backupRoot + '/artifacts'
export const controlRoot = '/run/rentnerproxy/backups'
export const stateFile = backupRoot + '/jobs.json'
export const sourceFile = '/usr/share/rentnerproxy/backup-source.json'

export async function privateDirectory(path: string): Promise<void> {
    await mkdir(path, { mode: 0o700, recursive: true })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077) !== 0)
        throw new Error('unsafe backup directory')
}

export async function readPrivateJson(path: string, maximum = 512 * 1024): Promise<unknown> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
        const info = await file.stat()
        if (!info.isFile() || info.nlink !== 1 || info.uid !== 0 || info.size > maximum)
            throw new Error('invalid backup state')
        return JSON.parse(await file.readFile('utf8')) as unknown
    } finally {
        await file.close()
    }
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
    const bytes = JSON.stringify(value) + '\n'
    if (Buffer.byteLength(bytes) > 512 * 1024) throw new Error('backup state limit')
    const temporary = path + '.' + randomUUID() + '.tmp'
    try {
        const file = await open(temporary, 'wx', 0o600)
        try {
            await file.writeFile(bytes)
            await file.sync()
        } finally {
            await file.close()
        }
        await rename(temporary, path)
        await syncBackupDirectory(dirname(path))
    } finally {
        await rm(temporary, { force: true })
    }
}
