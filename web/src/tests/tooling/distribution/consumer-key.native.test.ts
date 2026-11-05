// oxlint-disable no-await-in-loop -- Each candidate replaces the same download fixture before invoking the actual consumer.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
    distributionBytes,
    distributionCommand,
} from '../../../../../.github/scripts/distribution/process.ts'
import { runMaintenanceProcess } from '../../../../../scripts/backup/maintenance-process.ts'

const enabled = process.platform === 'linux' && process.env.RENTNERPROXY_PACKAGE_TEST === '1'
const source = fileURLToPath(new URL('../../../../../', import.meta.url))

test.skipIf(!enabled)(
    'public consumers reject an extra primary key before trusting signed metadata',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-consumer-key-'))
        try {
            const home = join(directory, 'gpg'),
                bin = join(directory, 'bin'),
                candidate = join(directory, 'download.asc'),
                progress = join(directory, 'metadata-requested')
            await mkdir(home, { mode: 0o700 })
            await mkdir(bin)
            for (const identity of ['Pinned', 'Foreign'])
                await distributionCommand([
                    'gpg',
                    '--homedir',
                    home,
                    '--batch',
                    '--passphrase',
                    '',
                    '--quick-generate-key',
                    identity + ' fixture <fixture@example.invalid>',
                    'ed25519',
                    'sign',
                    '1d',
                ])
            const fingerprints = (
                await distributionCommand([
                    'gpg',
                    '--homedir',
                    home,
                    '--with-colons',
                    '--list-keys',
                ])
            )
                .split('\n')
                .filter((line) => line.startsWith('fpr:'))
                .map((line) => line.split(':')[9]!)
            const pinned = await distributionBytes([
                    'gpg',
                    '--homedir',
                    home,
                    '--batch',
                    '--armor',
                    '--export',
                    fingerprints[0]!,
                ]),
                foreign = await distributionBytes([
                    'gpg',
                    '--homedir',
                    home,
                    '--batch',
                    '--armor',
                    '--export',
                    fingerprints[1]!,
                ])
            await writeFile(
                join(bin, 'curl'),
                `#!/bin/bash
set -eu
if [[ "$*" == *'/catalog.json'* ]]; then touch "$METADATA_PROGRESS"; exit 64; fi
output=''
while [[ $# -gt 0 ]]; do
    if [[ "$1" == --output ]]; then output=$2; break; fi
    shift
done
[[ -n "$output" ]]
cp -- "$KEY_CANDIDATE" "$output"
`,
                { mode: 0o755 },
            )
            for (const [bytes, proceeds] of [
                [pinned, true],
                [Buffer.concat([pinned, foreign]), false],
                [foreign, false],
            ] as const) {
                await writeFile(candidate, bytes)
                await rm(progress, { force: true })
                const result = await runMaintenanceProcess(
                    ['bash', join(source, '.github/scripts/distribution/published-consumer.sh')],
                    {
                        cwd: directory,
                        timeoutMs: 10_000,
                        maximumOutputBytes: 64 * 1024,
                        env: {
                            ...process.env,
                            PATH: bin + ':' + process.env.PATH,
                            GNUPGHOME: home,
                            PACKAGE_REPOSITORY_URL: 'https://fixture.invalid',
                            PACKAGE_SIGNING_FINGERPRINT: fingerprints[0]!,
                            TARGET: 'debian',
                            KEY_CANDIDATE: candidate,
                            METADATA_PROGRESS: progress,
                        },
                    },
                )
                expect(result.failed && result.stopped).toBe(true)
                expect(
                    await readFile(progress).then(
                        () => true,
                        () => false,
                    ),
                ).toBe(proceeds)
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)
