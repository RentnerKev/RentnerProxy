import { expect, mock, test } from 'bun:test'
import { withFreshStagingAcmeAccount } from '../../../../../../../scripts/smoke/certificates/account-fixture.ts'

const container = 'rentnerproxy-certificate-smoke-012345abcdef-runtime'
const account = '/var/lib/rentnerproxy/proxy/certificates/acme-accounts/staging.json'
const before = 'a'.repeat(64) + '  ' + account
const after = 'b'.repeat(64) + '  ' + account
const exec = ['docker', 'exec', '--user', '10001:10001', container]

test.each([
    'rentnerproxy-runtime',
    'production-runtime',
    container + '\n',
    container.replace('012345abcdef', '012345ABCDEf'),
])('rejects an unowned container before any command or operation: %s', async (name) => {
    const command = mock(async (_args: string[]) => '')
    const operation = mock(async () => undefined)
    await expect(withFreshStagingAcmeAccount(command, name, operation)).rejects.toThrow()
    expect(command).not.toHaveBeenCalled()
    expect(operation).not.toHaveBeenCalled()
})

test('missing account does not remove anything or start the order', async () => {
    const failure = new Error('account missing')
    const command = mock(async (_args: string[]) => {
        throw failure
    })
    const operation = mock(async () => undefined)
    await expect(withFreshStagingAcmeAccount(command, container, operation)).rejects.toBe(failure)
    expect(command.mock.calls).toEqual([[[...exec, 'test', '-f', account]]])
    expect(operation).not.toHaveBeenCalled()
})

test('removes only the exact staging account before the callback and verifies fresh credentials afterwards', async () => {
    const commands: string[][] = []
    let hashes = 0
    const command = mock(async (args: string[]) => {
        commands.push(args)
        return args.includes('sha256sum') ? (++hashes === 1 ? before : after) : ''
    })
    const paused = { operationId: 'manual-order', records: ['apex-proof', 'wildcard-proof'] }
    const operation = mock(async () => {
        expect(commands).toEqual([
            [...exec, 'test', '-f', account],
            [...exec, 'sha256sum', '--', account],
            [...exec, 'rm', '--', account],
        ])
        return paused
    })
    expect(await withFreshStagingAcmeAccount(command, container, operation)).toBe(paused)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(commands).toEqual([
        [...exec, 'test', '-f', account],
        [...exec, 'sha256sum', '--', account],
        [...exec, 'rm', '--', account],
        [...exec, 'sha256sum', '--', account],
    ])
})

test.each(['invalid', 'a'.repeat(64) + '  /elsewhere/staging.json'])(
    'invalid previous hash prevents deletion: %s',
    async (hash) => {
        const command = mock(async (args: string[]) => (args.includes('sha256sum') ? hash : ''))
        const operation = mock(async () => undefined)
        await expect(withFreshStagingAcmeAccount(command, container, operation)).rejects.toThrow(
            'hash is invalid',
        )
        expect(command.mock.calls.some(([args]) => args.includes('rm'))).toBe(false)
        expect(operation).not.toHaveBeenCalled()
    },
)

test.each([before, 'invalid', 'b'.repeat(64) + '  /elsewhere/staging.json'])(
    'requires a valid different credentials hash after the callback: %s',
    async (created) => {
        let hashes = 0
        const command = mock(async (args: string[]) =>
            args.includes('sha256sum') ? (++hashes === 1 ? before : created) : '',
        )
        const operation = mock(async () => undefined)
        await expect(withFreshStagingAcmeAccount(command, container, operation)).rejects.toThrow()
        expect(operation).toHaveBeenCalledTimes(1)
        expect(command).toHaveBeenCalledTimes(4)
    },
)

test('missing newly created credentials fails after one successful callback', async () => {
    let hashes = 0
    const failure = new Error('new credentials missing')
    const command = mock(async (args: string[]) => {
        if (!args.includes('sha256sum')) return ''
        if (++hashes === 2) throw failure
        return before
    })
    const operation = mock(async () => undefined)
    await expect(withFreshStagingAcmeAccount(command, container, operation)).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(1)
})

test('a failed exact-file removal never starts the callback', async () => {
    const failure = new Error('account removal failed')
    const command = mock(async (args: string[]) => {
        if (args.includes('rm')) throw failure
        return args.includes('sha256sum') ? before : ''
    })
    const operation = mock(async () => undefined)
    await expect(withFreshStagingAcmeAccount(command, container, operation)).rejects.toBe(failure)
    expect(operation).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledTimes(3)
})

test('propagates the original callback failure immediately without a hash check or retry', async () => {
    const failure = new Error('original manual order failure')
    const command = mock(async (args: string[]) => (args.includes('sha256sum') ? before : ''))
    const operation = mock(async () => {
        throw failure
    })
    await expect(withFreshStagingAcmeAccount(command, container, operation)).rejects.toBe(failure)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(command.mock.calls).toEqual([
        [[...exec, 'test', '-f', account]],
        [[...exec, 'sha256sum', '--', account]],
        [[...exec, 'rm', '--', account]],
    ])
})
