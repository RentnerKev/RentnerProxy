import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'

import type { Command } from '../alpha1-upgrade-fixture'

const directory = '/var/lib/rentnerproxy/proxy/certificates/acme-accounts'
const path = `${directory}/staging.json`

export interface AcmeAccountFixture {
    readonly sha256: string
}

async function fileDigest(command: Command, containerId: string): Promise<string> {
    const output = await command(['docker', 'exec', containerId, 'sha256sum', path])
    const digest = /^([0-9a-f]{64})\s/u.exec(output)?.[1]
    if (!digest) throw new Error('ACME account fixture digest unavailable')
    return digest
}

export async function seedAcmeAccountFixture(input: {
    readonly command: Command
    readonly containerId: string
}): Promise<AcmeAccountFixture> {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const key = privateKey.export({ type: 'pkcs8', format: 'der' })
    const state = Buffer.from(
        JSON.stringify({
            directory: 'https://acme-staging-v02.api.letsencrypt.org/directory',
            pendingKeyPkcs8: [...key],
            contactEmail: null,
        }),
    )
    const sha256 = createHash('sha256').update(state).digest('hex')
    await input.command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        input.containerId,
        'mkdir',
        '-m',
        '700',
        '-p',
        directory,
    ])
    await input.command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        input.containerId,
        'bun',
        '-e',
        `await Bun.write(${JSON.stringify(path)},Buffer.from(${JSON.stringify(state.toString('base64'))},'base64'))`,
    ])
    await input.command([
        'docker',
        'exec',
        '--user',
        '10001:10001',
        input.containerId,
        'chmod',
        '600',
        path,
    ])
    assert.equal(await fileDigest(input.command, input.containerId), sha256)
    return { sha256 }
}

export async function assertAcmeAccountFixture(input: {
    readonly command: Command
    readonly containerId: string
    readonly fixture: AcmeAccountFixture
}): Promise<void> {
    assert.equal(await fileDigest(input.command, input.containerId), input.fixture.sha256)
    assert.equal(
        await input.command(['docker', 'exec', input.containerId, 'stat', '-c', '%a:%u:%g', path]),
        '600:10001:10001',
    )
}
