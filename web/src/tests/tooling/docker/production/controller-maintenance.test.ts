import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { constants } from 'node:fs'
import { join } from 'node:path'

const controlRoot = '/isolated-controller-maintenance'
const requestPath = join(controlRoot, 'controller-maintenance-request.json')
const receiptPath = join(controlRoot, 'controller-maintenance-receipt.json')
const ownedPath = join(controlRoot, 'controller-maintenance-owned.json')
const id = '01900000-0000-7000-8000-000000000001'
const controllerPid = 101
const caddyPid = 102
type Info = { uid: number; gid: number; mode: number; size: number; nlink: number; link?: boolean }
const files = new Map<string, { bytes: string; info: Info }>()
const processes = new Map<number, { ticks: string; uid: string; binary: string; state?: string }>()
let uid = 0
let stuck = false
let clock = 0
let binaryFailed = false
let removeDuringVerification = false
let changeDuringVerification = false
let verifyOutput = '1:2'
const signals: Array<[number, string]> = []
const absent = () => Object.assign(new Error('missing fixture'), { code: 'ENOENT' })
function entry(path: string) {
    const file = files.get(path)
    if (!file) throw absent()
    return file
}
function metadata(info: Info) {
    return {
        ...info,
        isDirectory: () => info.mode === 0o750,
        isFile: () => true,
        isSymbolicLink: () => !!info.link,
    }
}
function put(path: string, value: unknown, owner = 0, mode = 0o600) {
    const bytes = JSON.stringify(value)
    files.set(path, { bytes, info: { uid: owner, gid: owner, mode, size: bytes.length, nlink: 1 } })
}
mock.module('node:fs/promises', () => ({
    lstat: async (path: string) => metadata(entry(path).info),
    stat: async () => ({ dev: 1n, ino: 2n }),
    readFile: async (path: string) => {
        const parsed = /^\/proc\/(\d+)\/(stat|status)$/u.exec(path)
        if (!parsed) return entry(path).bytes
        const process = processes.get(Number(parsed[1]))
        if (!process) throw absent()
        return parsed[2] === 'stat'
            ? `${parsed[1]} (a tricky ) process) S ${Array(18).fill('0').join(' ')} ${process.ticks} 0`
            : `State:\t${process.state ?? 'S'} (fixture)\nUid:\t${process.uid}\n`
    },
    rm: async (path: string) => {
        files.delete(path)
    },
    open: async (path: string, flags: number | string, mode?: number) => {
        if (flags === 'wx') {
            if (files.has(path)) throw new Error('exclusive fixture exists')
            put(path, null, 0, mode)
            entry(path).bytes = ''
            entry(path).info.size = 0
        } else {
            expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
            if (entry(path).info.link) throw new Error('symlink refused')
        }
        const file = entry(path)
        return {
            stat: async () => metadata(file.info),
            chown: async (owner: number, group: number) => {
                file.info.uid = owner
                file.info.gid = group
            },
            chmod: async (permissions: number) => {
                file.info.mode = permissions
            },
            sync: async () => {},
            close: async () => {},
            read: async (buffer: Buffer) => ({ bytesRead: buffer.write(file.bytes) }),
        }
    },
}))
mock.module('../../../../../../docker/production/backups/storage.ts', () => ({
    controlRoot,
    readPrivateJson: async (path: string) => {
        const file = entry(path)
        if (file.info.uid !== 0 || file.info.link || file.info.nlink !== 1)
            throw new Error('unsafe fixture state')
        return JSON.parse(file.bytes)
    },
    writePrivateJson: async (
        path: string,
        value: unknown,
        publication?: { gid: number; mode: number },
    ) => {
        put(path, value, 0, publication?.mode)
        if (publication) entry(path).info.gid = publication.gid
    },
}))
mock.module('../../../../../../scripts/backup/maintenance-process.ts', () => ({
    runMaintenanceProcess: async (args: string[], options: object) => {
        const pid = Number(args.at(-1)!.split('/')[2])
        expect(args).toEqual([
            'gosu',
            'rentnerproxy',
            'stat',
            '--dereference',
            '--format=%d:%i',
            '--',
            `/proc/${pid}/exe`,
        ])
        expect(options).toEqual({
            cwd: '/',
            env: { PATH: '/usr/local/bin:/usr/bin:/bin', LC_ALL: 'C' },
            timeoutMs: 2_000,
            maximumOutputBytes: 128,
        })
        expect(processes.get(pid)?.binary).toBe(pid === controllerPid ? 'controller' : 'caddy')
        if (removeDuringVerification) processes.delete(pid)
        if (changeDuringVerification) processes.get(pid)!.ticks = 'changed'
        return { stopped: true, failed: binaryFailed, stdout: Buffer.from(verifyOutput) }
    },
}))
const {
    prepareControllerMaintenance,
    claimControllerMaintenance,
    assertRetainedCaddy,
    finishControllerMaintenance,
    processStartTicks,
} = await import('../../../../../../docker/production/backups/controller-maintenance.ts')
const originalUid = Object.getOwnPropertyDescriptor(process, 'getuid')
const restorers: Array<() => void> = []

beforeEach(() => {
    files.clear()
    processes.clear()
    signals.length = 0
    uid = 0
    stuck = false
    clock = 0
    binaryFailed = false
    removeDuringVerification = false
    changeDuringVerification = false
    verifyOutput = '1:2'
    put(controlRoot, null, 0, 0o750)
    entry(controlRoot).info.gid = 10001
    processes.set(controllerPid, {
        ticks: '100',
        uid: '10001\t10001\t10001\t10001',
        binary: 'controller',
    })
    processes.set(caddyPid, { ticks: '200', uid: '10001\t10001\t10001\t10001', binary: 'caddy' })
    put(join(controlRoot, 'active.json'), { id, kind: 'restore' })
    Object.defineProperty(process, 'getuid', { configurable: true, value: () => uid })
    const kill = spyOn(process, 'kill').mockImplementation((pid, signal) => {
        signals.push([pid, String(signal)])
        if (!stuck || signal === 'SIGKILL') processes.delete(pid)
        return true
    })
    const sleep = spyOn(Bun, 'sleep').mockImplementation(async (ms) => {
        clock += Number(ms)
    })
    const now = spyOn(performance, 'now').mockImplementation(() => clock)
    restorers.push(() => {
        kill.mockRestore()
        sleep.mockRestore()
        now.mockRestore()
    })
})
afterEach(() => {
    for (const restore of restorers.splice(0)) restore()
    if (originalUid) Object.defineProperty(process, 'getuid', originalUid)
    else Reflect.deleteProperty(process, 'getuid')
})
async function prepareReceipt() {
    await prepareControllerMaintenance(id, controllerPid)
    const file = entry(receiptPath)
    file.bytes = JSON.stringify({ id, controllerPid, caddyPid, caddyStartTicks: '200' })
    file.info.size = file.bytes.length
    processes.delete(controllerPid)
}

test('root authorizes only the exact controller, seals its one-use Caddy receipt and preserves progress transport', async () => {
    await prepareReceipt()
    expect(entry(requestPath).info).toMatchObject({ uid: 0, gid: 10001, mode: 0o440 })
    expect(JSON.parse(entry(requestPath).bytes)).toMatchObject({
        id,
        controllerPid,
        controllerStartTicks: '100',
    })
    expect(await claimControllerMaintenance(id)).toBe(caddyPid)
    expect(entry(receiptPath).info).toMatchObject({ uid: 0, gid: 0, mode: 0o600 })
    expect(JSON.parse(entry(join(controlRoot, 'restore-progress.json')).bytes)).toEqual({
        id,
        phase: 'preparing',
        progressPercent: 3,
    })
    await assertRetainedCaddy(id, caddyPid)
    expect(signals).toEqual([])
    await finishControllerMaintenance(id)
    expect(signals).toEqual([[caddyPid, 'SIGTERM']])
    for (const path of [requestPath, receiptPath, ownedPath]) expect(files.has(path)).toBe(false)
})

test('stuck retained Caddy is killed within its fixed budget; reused PIDs are never signaled', async () => {
    await prepareReceipt()
    await claimControllerMaintenance(id)
    stuck = true
    await finishControllerMaintenance(id)
    expect(clock).toBe(2000)
    expect(signals).toEqual([
        [caddyPid, 'SIGTERM'],
        [caddyPid, 'SIGKILL'],
    ])
    signals.length = 0
    put(ownedPath, { id, controllerPid, caddyPid, caddyStartTicks: '200' })
    processes.set(caddyPid, { ticks: '201', uid: '10001\t10001\t10001\t10001', binary: 'caddy' })
    await finishControllerMaintenance(id)
    expect(signals).toEqual([])
})

test.each([
    'uid',
    'group',
    'mode',
    'link',
    'non-root',
    'already-active',
    'foreign-uid',
    'binary',
    'verification-failure',
    'pid-race',
    'exited',
])('unsafe preparation refuses %s before handing off any process', async (scenario) => {
    if (scenario === 'uid') entry(controlRoot).info.uid = 10001
    if (scenario === 'group') entry(controlRoot).info.gid = 10002
    if (scenario === 'mode') entry(controlRoot).info.mode = 0o7750
    if (scenario === 'link') entry(controlRoot).info.link = true
    if (scenario === 'non-root') uid = 10001
    if (scenario === 'already-active') put(ownedPath, {})
    if (scenario === 'foreign-uid') processes.get(controllerPid)!.uid = '10001\t0\t10001\t10001'
    if (scenario === 'binary') verifyOutput = '1:3'
    if (scenario === 'verification-failure' || scenario === 'exited') binaryFailed = true
    if (scenario === 'pid-race') changeDuringVerification = true
    if (scenario === 'exited') removeDuringVerification = true
    await expect(prepareControllerMaintenance(id, controllerPid)).rejects.toThrow()
    expect(signals).toEqual([])
})
test.each([
    'id',
    'controller',
    'owner',
    'group',
    'mode',
    'link',
    'hardlink',
    'oversize',
    'malformed',
    'ticks',
    'active',
    'binary',
    'replay',
])('unsafe receipt refuses %s without claiming a process', async (scenario) => {
    await prepareReceipt()
    const file = entry(receiptPath)
    const receipt = JSON.parse(file.bytes)
    if (scenario === 'id') receipt.id = '01900000-0000-7000-8000-000000000002'
    if (scenario === 'controller') receipt.controllerPid = 103
    file.bytes = JSON.stringify(receipt)
    if (scenario === 'owner') file.info.uid = 10002
    if (scenario === 'group') file.info.gid = 10002
    if (scenario === 'mode') file.info.mode = 0o6600
    if (scenario === 'link') file.info.link = true
    if (scenario === 'hardlink') file.info.nlink = 2
    if (scenario === 'oversize') file.info.size = 1025
    if (scenario === 'malformed') file.bytes = '{}'
    if (scenario === 'ticks') processes.get(caddyPid)!.ticks = '201'
    if (scenario === 'active') put(join(controlRoot, 'active.json'), { id: receipt.id + 'x' })
    if (scenario === 'binary') verifyOutput = '1:3'
    if (scenario === 'replay') await claimControllerMaintenance(id)
    await expect(claimControllerMaintenance(id)).rejects.toThrow()
    expect(signals).toEqual([])
})
test('absent or exited Caddy requires no signal, and unrelated operations cannot assert or finish it', async () => {
    await finishControllerMaintenance(id)
    await prepareReceipt()
    await claimControllerMaintenance(id)
    await expect(
        assertRetainedCaddy('01900000-0000-7000-8000-000000000002', caddyPid),
    ).rejects.toThrow()
    await expect(
        finishControllerMaintenance('01900000-0000-7000-8000-000000000002'),
    ).rejects.toThrow()
    processes.get(caddyPid)!.state = 'Z'
    await finishControllerMaintenance(id)
    expect(signals).toEqual([])
})
test('proc parser binds field 22 even when process names contain closing parentheses', () => {
    expect(
        processStartTicks('101 (a ) tricky) S ' + Array(18).fill('0').join(' ') + ' 12345 0'),
    ).toBe('12345')
    expect(() => processStartTicks('invalid')).toThrow()
    expect(() => processStartTicks('101 (name) S 0')).toThrow()
})
