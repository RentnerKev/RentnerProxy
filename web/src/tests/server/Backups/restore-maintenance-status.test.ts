import { beforeEach, expect, mock, test } from 'bun:test'
import { constants } from 'node:fs'

const open = mock(async (_path: string, _flags: number) => file)
const stat = mock(async () => ({
    uid: 0,
    nlink: 1,
    mode: 0o100440,
    size: 20,
    isFile: (): boolean => true,
}))
let contents = JSON.stringify({ maintenance: null })
const read = mock(async (buffer: Buffer) => ({ bytesRead: buffer.write(contents) }))
const close = mock(async () => undefined)
const file = { stat, read, close }
mock.module('node:fs/promises', () => ({ open }))

const { readRestoreMaintenanceStatus } =
    await import('@/server/Backups/restore-maintenance-status.server.ts')

beforeEach(() => {
    contents = JSON.stringify({ maintenance: null })
    open.mockReset().mockResolvedValue(file)
    stat.mockReset().mockResolvedValue({
        uid: 0,
        nlink: 1,
        mode: 0o100440,
        size: 20,
        isFile: (): boolean => true,
    })
    read.mockReset().mockImplementation(async (buffer: Buffer) => ({
        bytesRead: buffer.write(contents),
    }))
    close.mockReset().mockResolvedValue(undefined)
})

test('reads only the root-owned fixed maintenance file with no symlink following', async () => {
    expect(await readRestoreMaintenanceStatus()).toBeNull()
    expect(open).toHaveBeenCalledWith(
        '/run/rentnerproxy/maintenance/progress.json',
        constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    expect(close).toHaveBeenCalledTimes(1)
})

test.each([
    { name: 'web-owned file', change: { uid: 10002 } },
    { name: 'hardlinked file', change: { nlink: 2 } },
    { name: 'group-writable file', change: { mode: 0o100460 } },
    { name: 'oversized file', change: { size: 16_385 } },
    { name: 'non-regular file', change: { isFile: () => false } },
    { name: 'detached web-owned file', change: { nlink: 0, uid: 10002 } },
    { name: 'detached group-writable file', change: { nlink: 0, mode: 0o100460 } },
    { name: 'detached oversized file', change: { nlink: 0, size: 16_385 } },
    { name: 'detached non-regular file', change: { nlink: 0, isFile: () => false } },
])('rejects $name before reading progress', async ({ change }) => {
    stat.mockResolvedValue({
        uid: 0,
        nlink: 1,
        mode: 0o100440,
        size: 20,
        isFile: () => true,
        ...change,
    })
    await expect(readRestoreMaintenanceStatus()).rejects.toThrow(
        'Invalid restore maintenance status file',
    )
    expect(read).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
})

test.each([
    '{',
    '{"maintenance":{"progressPercent":101}}',
    '{"maintenance":null,"privateSessions":["forbidden"]}',
])('rejects malformed progress without returning private data: %s', async (malformed) => {
    contents = malformed
    await expect(readRestoreMaintenanceStatus()).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
})

test('detects growth past its bound during the read', async () => {
    contents += ' '.repeat(16_385)
    await expect(readRestoreMaintenanceStatus()).rejects.toThrow(
        'Restore maintenance status is too large',
    )
    expect(close).toHaveBeenCalledTimes(1)
})

test('treats a missing file as inactive but preserves a symlink rejection', async () => {
    open.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect(await readRestoreMaintenanceStatus()).toBeNull()
    open.mockRejectedValueOnce(Object.assign(new Error('symlink rejected'), { code: 'ELOOP' }))
    await expect(readRestoreMaintenanceStatus()).rejects.toThrow('symlink rejected')
    expect(close).not.toHaveBeenCalled()
})

test('closes a detached progress inode before reopening the published snapshot', async () => {
    const detached = {
        stat: mock(async () => ({
            uid: 0,
            nlink: 0,
            mode: 0o100440,
            size: 20,
            isFile: () => true,
        })),
        read: mock(async (buffer: Buffer) => ({
            bytesRead: buffer.write('{"maintenance":"old"}'),
        })),
        close: mock(async () => undefined),
    }
    open.mockResolvedValueOnce(detached)
    expect(await readRestoreMaintenanceStatus()).toBeNull()
    expect(open).toHaveBeenCalledTimes(2)
    expect(detached.read).not.toHaveBeenCalled()
    expect(detached.close).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
})

test('bounds replacement retries and closes every detached descriptor without reading', async () => {
    stat.mockResolvedValue({ uid: 0, nlink: 0, mode: 0o100440, size: 20, isFile: () => true })
    await expect(readRestoreMaintenanceStatus()).rejects.toThrow(
        'Invalid restore maintenance status file',
    )
    expect(open).toHaveBeenCalledTimes(8)
    expect(close).toHaveBeenCalledTimes(8)
    expect(read).not.toHaveBeenCalled()
})

test.each(['ELOOP', 'ENOENT'])(
    'preserves %s handling when the published path changes again during retry',
    async (code) => {
        stat.mockResolvedValue({ uid: 0, nlink: 0, mode: 0o100440, size: 20, isFile: () => true })
        const error = Object.assign(new Error('fixture open failure'), { code })
        open.mockResolvedValueOnce(file).mockRejectedValueOnce(error)
        if (code === 'ENOENT') expect(await readRestoreMaintenanceStatus()).toBeNull()
        else await expect(readRestoreMaintenanceStatus()).rejects.toBe(error)
        expect(close).toHaveBeenCalledTimes(1)
        expect(read).not.toHaveBeenCalled()
    },
)

test('revalidates hardlink safety on the reopened progress publication', async () => {
    stat.mockResolvedValueOnce({
        uid: 0,
        nlink: 0,
        mode: 0o100440,
        size: 20,
        isFile: () => true,
    }).mockResolvedValueOnce({ uid: 0, nlink: 2, mode: 0o100440, size: 20, isFile: () => true })
    await expect(readRestoreMaintenanceStatus()).rejects.toThrow(
        'Invalid restore maintenance status file',
    )
    expect(open).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
    expect(read).not.toHaveBeenCalled()
})

test.each(['stat', 'read'] as const)(
    'closes progress descriptors after %s errors',
    async (stage) => {
        if (stage === 'stat') stat.mockRejectedValue(new Error('fixture stat failure'))
        else read.mockRejectedValue(new Error('fixture read failure'))
        await expect(readRestoreMaintenanceStatus()).rejects.toThrow()
        expect(open).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledTimes(1)
    },
)
