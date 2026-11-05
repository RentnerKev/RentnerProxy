import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { constants } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fs = { ...nodeFs }
const stat = mock(async () => ({ uid: 0, nlink: 1, size: 20, isFile: (): boolean => true }))
const readFile = mock(async (_encoding: string) => '{"snapshot":"current"}')
const close = mock(async () => undefined)
const file = { stat, readFile, close }
const open = mock(async (_path: string, _flags: number) => file)
mock.module('node:fs/promises', () => ({ ...fs, open }))
const { readPrivateJson } = await import('../../../../../../docker/production/backups/storage.ts')
let directory: string | undefined
const descriptors: nodeFs.FileHandle[] = []

beforeEach(() => {
    open.mockReset().mockResolvedValue(file)
    stat.mockReset().mockResolvedValue({ uid: 0, nlink: 1, size: 20, isFile: () => true })
    readFile.mockReset().mockResolvedValue('{"snapshot":"current"}')
    close.mockReset().mockResolvedValue(undefined)
})

afterEach(async () => {
    await Promise.allSettled(descriptors.splice(0).map((descriptor) => descriptor.close()))
    if (directory) {
        if (!directory.startsWith(join(tmpdir(), 'rentnerproxy-storage-')))
            throw new Error('Unsafe storage fixture cleanup path')
        await fs.rm(directory, { recursive: true, force: true })
        directory = undefined
    }
})

test('reads root-owned state with symlink following disabled', async () => {
    expect(await readPrivateJson('/private/state.json')).toEqual({ snapshot: 'current' })
    expect(open).toHaveBeenCalledWith(
        '/private/state.json',
        constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    expect(close).toHaveBeenCalledTimes(1)
})

test.skipIf(process.platform !== 'linux' || process.getuid?.() !== 0)(
    'reopens a real inode unlinked by atomic rename before fstat and returns the new snapshot',
    async () => {
        directory = await fs.mkdtemp(join(tmpdir(), 'rentnerproxy-storage-'))
        const path = join(directory, 'state.json')
        await fs.writeFile(path, '{"snapshot":"detached"}', { mode: 0o600 })
        let replace = true
        const closes: ReturnType<typeof spyOn<nodeFs.FileHandle, 'close'>>[] = []
        open.mockImplementation(async (current, flags) => {
            const descriptor = await fs.open(current, flags)
            descriptors.push(descriptor)
            closes.push(spyOn(descriptor, 'close'))
            if (replace) {
                replace = false
                await fs.writeFile(path + '.next', '{"snapshot":"published"}', { mode: 0o600 })
                await fs.rename(path + '.next', path)
                expect((await descriptor.stat()).nlink).toBe(0)
            }
            return descriptor as unknown as typeof file
        })
        expect(await readPrivateJson(path)).toEqual({ snapshot: 'published' })
        expect(open).toHaveBeenCalledTimes(2)
        for (const closed of closes) expect(closed).toHaveBeenCalledTimes(1)
        await Promise.all(
            descriptors.map((descriptor) => expect(descriptor.stat()).rejects.toThrow()),
        )
    },
)

test('bounds repeated detached snapshots and closes every descriptor without reading', async () => {
    stat.mockResolvedValue({ uid: 0, nlink: 0, size: 20, isFile: () => true })
    const closes: Array<ReturnType<typeof mock>> = []
    open.mockImplementation(async () => {
        const currentClose = mock(async () => undefined)
        closes.push(currentClose)
        return { stat, readFile, close: currentClose }
    })
    await expect(readPrivateJson('/private/state.json')).rejects.toThrow('invalid backup state')
    expect(open).toHaveBeenCalledTimes(8)
    expect(readFile).not.toHaveBeenCalled()
    for (const closed of closes) expect(closed).toHaveBeenCalledTimes(1)
})

test.each([
    { name: 'hardlinked', change: { nlink: 2 } },
    { name: 'non-root-owned', change: { uid: 10001 } },
    { name: 'oversized', change: { size: 21 } },
    { name: 'non-regular', change: { isFile: () => false } },
    { name: 'detached non-root-owned', change: { nlink: 0, uid: 10001 } },
    { name: 'detached oversized', change: { nlink: 0, size: 21 } },
    { name: 'detached non-regular', change: { nlink: 0, isFile: () => false } },
])('rejects $name metadata without retrying or reading', async ({ change }) => {
    stat.mockResolvedValue({ uid: 0, nlink: 1, size: 20, isFile: () => true, ...change })
    await expect(readPrivateJson('/private/state.json', 20)).rejects.toThrow('invalid backup state')
    expect(open).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(readFile).not.toHaveBeenCalled()
})

test.each(['ELOOP', 'ENOENT'])(
    'preserves %s open errors after closing an atomically replaced descriptor',
    async (code) => {
        stat.mockResolvedValue({ uid: 0, nlink: 0, size: 20, isFile: () => true })
        const error = Object.assign(new Error('fixture open failure'), { code })
        open.mockResolvedValueOnce(file).mockRejectedValueOnce(error)
        await expect(readPrivateJson('/private/state.json')).rejects.toBe(error)
        expect(close).toHaveBeenCalledTimes(1)
        expect(readFile).not.toHaveBeenCalled()
    },
)

test('revalidates hardlink safety on the reopened publication', async () => {
    stat.mockResolvedValueOnce({
        uid: 0,
        nlink: 0,
        size: 20,
        isFile: () => true,
    }).mockResolvedValueOnce({ uid: 0, nlink: 2, size: 20, isFile: () => true })
    await expect(readPrivateJson('/private/state.json')).rejects.toThrow('invalid backup state')
    expect(open).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
    expect(readFile).not.toHaveBeenCalled()
})

test.each(['stat', 'read', 'json'] as const)(
    'closes descriptors after %s failures',
    async (stage) => {
        if (stage === 'stat') stat.mockRejectedValue(new Error('fixture stat failure'))
        else if (stage === 'read') readFile.mockRejectedValue(new Error('fixture read failure'))
        else readFile.mockResolvedValue('{')
        await expect(readPrivateJson('/private/state.json')).rejects.toThrow()
        expect(open).toHaveBeenCalledTimes(1)
        expect(close).toHaveBeenCalledTimes(1)
    },
)
