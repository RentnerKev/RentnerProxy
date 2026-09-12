import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { stateArchiveExclusions } from './controller-state-archive'

type Command = (args: string[], options?: { timeoutMs?: number }) => Promise<string>

export async function restoreCertificateStateFixture(
    command: Command,
    input: { container: string; volume: string; image: string; requiredFiles: readonly string[] },
): Promise<void> {
    assert.match(input.container, /^rentnerproxy-certificate-smoke-[a-f0-9]{12}-runtime$/u)
    assert.match(input.volume, /^rentnerproxy-certificate-smoke-[a-f0-9]{12}-state$/u)
    const archiveVolume = input.volume + '-restore-' + randomUUID().replaceAll('-', '')
    await command(['docker', 'volume', 'create', archiveVolume])
    try {
        await command([
            'docker',
            'run',
            '--rm',
            '--user',
            '0:0',
            '--entrypoint',
            'chown',
            '--volume',
            archiveVolume + ':/archive',
            input.image,
            '10001:10001',
            '/archive',
        ])
        await command(['docker', 'stop', input.container], { timeoutMs: 60_000 })
        const run = [
            'docker',
            'run',
            '--rm',
            '--user',
            '10001:10001',
            '--entrypoint',
            'sh',
            '--volume',
            input.volume + ':/state',
            '--volume',
            archiveVolume + ':/archive',
            input.image,
            '-ceu',
        ]
        const exclusions = stateArchiveExclusions
            .map((entry) => "--exclude='" + entry + "'")
            .join(' ')
        const files = await command([
            ...run,
            'tar --create --file=/archive/controller-state.tar --directory=/state ' +
                exclusions +
                ' .; ' +
                'mkdir /archive/expected; tar --extract --file=/archive/controller-state.tar --directory=/archive/expected; ' +
                'cd /archive/expected; find . -type f -print | LC_ALL=C sort',
        ])
        for (const path of input.requiredFiles) {
            assert.ok(
                files.split('\n').includes('./' + path),
                'Backup omitted required state: ' + path,
            )
        }
        assert.doesNotMatch(files, /(?:^|\n)\.\/logs\//u)
        await command([
            ...run,
            'cd /archive/expected; find . -type f -exec sha256sum {} + | LC_ALL=C sort > /archive/expected.sha256; ' +
                'find /state -mindepth 1 -delete; ' +
                'tar --extract --file=/archive/controller-state.tar --directory=/state; ' +
                'cd /state; find . -type f -exec sha256sum {} + | LC_ALL=C sort > /archive/restored.sha256; ' +
                'cmp /archive/expected.sha256 /archive/restored.sha256',
        ])
    } finally {
        await command(['docker', 'volume', 'rm', archiveVolume]).catch(() => undefined)
    }
}
