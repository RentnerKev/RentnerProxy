import assert from 'node:assert/strict'
import type { Command } from './Types/state-restore.types.ts'

const stagingAccount = '/var/lib/rentnerproxy/proxy/certificates/acme-accounts/staging.json'

async function accountHash(command: Command, container: string): Promise<string> {
    const output = await command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        container,
        'sha256sum',
        '--',
        stagingAccount,
    ])
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(output.trim())
    assert.ok(match && match[2] === stagingAccount, 'Staging ACME account hash is invalid')
    return match[1]!
}

export async function withFreshStagingAcmeAccount<TResult>(
    command: Command,
    container: string,
    operation: () => Promise<TResult>,
): Promise<TResult> {
    assert.match(container, /^rentnerproxy-certificate-smoke-[a-f0-9]{12}-runtime$/u)
    assert.equal(container, container.trim())
    await command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        container,
        'test',
        '-f',
        stagingAccount,
    ])
    const previous = await accountHash(command, container)
    await command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        container,
        'rm',
        '--',
        stagingAccount,
    ])
    const result = await operation()
    const created = await accountHash(command, container)
    assert.ok(
        created !== previous,
        'Manual DNS order did not create fresh staging ACME credentials',
    )
    return result
}
