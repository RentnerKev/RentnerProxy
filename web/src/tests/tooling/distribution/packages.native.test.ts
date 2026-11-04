// oxlint-disable no-await-in-loop -- Real package-manager version comparisons and repository mutations are sequential.
import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DistributionRelease } from '../../../../../.github/scripts/distribution/Types/distribution.types.ts'
import {
    distributionPackageVersion,
    parseDistributionRelease,
} from '../../../../../.github/scripts/distribution/release.ts'
import {
    buildDistributionPackages,
    verifyDistributionPackage,
} from '../../../../../.github/scripts/distribution/packages.ts'
import {
    distributionBytes,
    distributionCommand,
} from '../../../../../.github/scripts/distribution/process.ts'
import {
    updatePackageRepository,
    withSigningKey,
} from '../../../../../.github/scripts/distribution/repository.ts'
import { distributionPayload } from '../../../../../.github/scripts/distribution/payload.ts'

const enabled = process.platform === 'linux' && process.env.RENTNERPROXY_PACKAGE_TEST === '1'
const source = fileURLToPath(new URL('../../../../../', import.meta.url))
const release = parseDistributionRelease({
    schemaVersion: 1,
    version: 'v1.0.0-beta.3',
    revision: 'a'.repeat(40),
    digest: 'sha256:' + 'b'.repeat(64),
    platform: 'linux/amd64',
    packageRevision: 1,
})

test.skipIf(!enabled)(
    'the minimum Podman version generates private ports, durable storage and graceful stop before removal',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-quadlet-generator-'))
        try {
            for (const file of await distributionPayload(source, release)) {
                if (file.path.endsWith('.container') || file.path.endsWith('.volume'))
                    await writeFile(join(directory, file.path.split('/').at(-1)!), file.content)
            }
            const generated = await distributionCommand(
                ['/usr/lib/systemd/system-generators/podman-system-generator', '--dryrun'],
                { env: { ...process.env, QUADLET_UNIT_DIRS: directory } },
            )
            expect(generated).toContain('--publish 127.0.0.1:81:3000/tcp')
            expect(generated).toContain('--publish 443:8443/udp')
            expect(generated).toContain('--image-volume=ignore')
            expect(generated).toContain('--health-on-failure kill')
            expect(generated.indexOf('ExecStop=/usr/bin/podman stop')).toBeLessThan(
                generated.indexOf('ExecStop=/usr/bin/podman rm'),
            )
            const volumeUnit = generated
                .split('---rentnerproxy-volume.service---')[1]!
                .split('---rentnerproxy.service---')[0]!
            expect(volumeUnit).toContain('RemainAfterExit=yes')
            expect(volumeUnit).not.toContain('ExecStop=')
            expect(volumeUnit).not.toContain('volume rm')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)

test.skipIf(!enabled)(
    'dpkg and RPM preserve SemVer order, including typed tokens, ASCII and package revisions',
    async () => {
        const ordered = [
            'v1.0.0-alpha',
            'v1.0.0-alpha.1',
            'v1.0.0-alpha.2',
            'v1.0.0-alpha.10',
            'v1.0.0-alpha.A',
            'v1.0.0-alpha.A-',
            'v1.0.0-alpha.AA',
            'v1.0.0-alpha.Z',
            'v1.0.0-alpha.a',
            'v1.0.0-alpha.a.1',
            'v1.0.0-alpha.aa',
            'v1.0.0-beta',
            'v1.0.0-beta.1',
            'v1.0.0-beta.test-alpha',
            'v1.0.0',
            'v1.0.1-alpha.1',
            'v1.0.1',
            'v1.1.0',
            'v2.0.0',
        ]
        const versions = ordered.map((version) => distributionPackageVersion(version))
        for (let index = 1; index < versions.length; index++) {
            const a = versions[index - 1]!,
                b = versions[index]!
            await distributionCommand([
                'dpkg',
                '--compare-versions',
                a.debian,
                'lt',
                b.debian,
            ]).catch(() => {
                throw new Error('Incorrect Debian order: ' + a.debian + ' < ' + b.debian)
            })
            expect(
                (
                    await distributionCommand([
                        'rpm',
                        '--eval',
                        `%{lua:print(rpm.vercmp("${a.rpmVersion}-${a.rpmRelease}","${b.rpmVersion}-${b.rpmRelease}"))}`,
                    ])
                ).trim(),
            ).toBe('-1')
        }
        for (const version of ['v1.0.0-alpha.1', 'v1.0.0-beta.test-alpha', 'v1.0.0']) {
            const a = distributionPackageVersion(version, 1),
                b = distributionPackageVersion(version, 2)
            await distributionCommand(['dpkg', '--compare-versions', a.debian, 'lt', b.debian])
            expect(
                (
                    await distributionCommand([
                        'rpm',
                        '--eval',
                        `%{lua:print(rpm.vercmp("${a.rpmVersion}-${a.rpmRelease}","${b.rpmVersion}-${b.rpmRelease}"))}`,
                    ])
                ).trim(),
            ).toBe('-1')
        }
    },
    30_000,
)

test.skipIf(!enabled)(
    'builds complete packages on both architectures, rejects payload substitution and signs anonymous APT/RPM repositories',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-package-test-'))
        try {
            const artifacts: { directory: string; release: DistributionRelease }[] = []
            for (const platform of ['linux/amd64', 'linux/arm64'] as const) {
                const identity = { ...release, platform },
                    output = join(directory, platform.split('/')[1]!)
                await buildDistributionPackages(source, output, identity)
                artifacts.push({ directory: output, release: identity })
            }
            const manifest = JSON.parse(
                await readFile(join(artifacts[0]!.directory, 'manifest.json'), 'utf8'),
            )
            const deb = join(
                artifacts[0]!.directory,
                manifest.files.find((file: { file: string }) => file.file.endsWith('.deb')).file,
            )
            await expect(
                verifyDistributionPackage(deb, source, {
                    ...release,
                    digest: 'sha256:' + 'c'.repeat(64),
                }),
            ).rejects.toThrow('mismatch')
            const home = join(directory, 'fixture-key')
            await mkdir(home, { mode: 0o700 })
            await distributionCommand([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--passphrase',
                '',
                '--quick-generate-key',
                'RentnerProxy isolated fixture <fixture@example.invalid>',
                'rsa3072',
                'sign',
                '90d',
            ])
            const fingerprint = (
                await distributionCommand([
                    'gpg',
                    '--homedir',
                    home,
                    '--with-colons',
                    '--list-keys',
                ])
            )
                .split('\n')
                .find((line) => line.startsWith('fpr:'))!
                .split(':')[9]!
            const key = await distributionBytes([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--export-secret-keys',
                fingerprint,
            ])
            const root = join(directory, 'public')
            await withSigningKey(key, fingerprint, async (signingHome) => {
                const options = {
                    root,
                    source,
                    artifacts,
                    home: signingHome,
                    fingerprint,
                    baseUrl: 'https://rentnerkev.github.io/RentnerProxy',
                }
                expect(await updatePackageRepository(options)).toHaveLength(2)
                const signed = await readFile(
                    join(
                        root,
                        'releases/v1.0.0-beta.3/1/amd64',
                        manifest.files.find((file: { file: string }) => file.file.endsWith('.rpm'))
                            .file,
                    ),
                )
                expect(await updatePackageRepository(options)).toHaveLength(2)
                expect(
                    await readFile(
                        join(
                            root,
                            'releases/v1.0.0-beta.3/1/amd64',
                            manifest.files.find((file: { file: string }) =>
                                file.file.endsWith('.rpm'),
                            ).file,
                        ),
                    ),
                ).toEqual(signed)
                await expect(
                    updatePackageRepository({
                        ...options,
                        artifacts: [
                            { ...artifacts[0]!, release: { ...release, revision: 'c'.repeat(40) } },
                        ],
                    }),
                ).rejects.toThrow()
            })
            const keyring = join(directory, 'keyring.gpg')
            await writeFile(
                keyring,
                await distributionBytes(['gpg', '--homedir', home, '--export', fingerprint]),
            )
            for (const signature of ['apt/dists/beta/InRelease', 'catalog.json.asc']) {
                await distributionCommand([
                    'gpgv',
                    '--keyring',
                    keyring,
                    join(root, signature),
                    ...(signature.endsWith('.asc') ? [join(root, signature.slice(0, -4))] : []),
                ])
            }
            const rpmdb = join(directory, 'rpmdb')
            await distributionCommand([
                'rpm',
                '--dbpath',
                rpmdb,
                '--import',
                join(root, 'keys', fingerprint + '.asc'),
            ])
            const signedRpm = join(
                root,
                'releases/v1.0.0-beta.3/1/amd64',
                manifest.files.find((file: { file: string }) => file.file.endsWith('.rpm')).file,
            )
            await distributionCommand(['rpmkeys', '--dbpath', rpmdb, '--checksig', signedRpm])
            await expect(
                distributionCommand([
                    'rpmkeys',
                    '--dbpath',
                    join(directory, 'empty-rpmdb'),
                    '--checksig',
                    signedRpm,
                ]),
            ).rejects.toThrow()
            const lists = join(directory, 'apt-lists'),
                configuration = join(directory, 'fixture.list'),
                download = join(directory, 'download')
            await mkdir(lists)
            await mkdir(download)
            await writeFile(
                configuration,
                `deb [signed-by=${keyring}] file:${root}/apt beta main\n`,
            )
            const apt = [
                'apt-get',
                '-o',
                'APT::Sandbox::User=root',
                '-o',
                'APT::Architecture=amd64',
                '-o',
                'Dir::State::lists=' + lists,
                '-o',
                'Dir::Etc::sourcelist=' + configuration,
                '-o',
                'Dir::Etc::sourceparts=-',
            ]
            await distributionCommand([...apt, 'update'])
            await distributionCommand([...apt, 'download', 'rentnerproxy'], { cwd: download })
            // A signed index must still reject a changed package body.
            await writeFile(
                join(
                    root,
                    'apt/pool/main',
                    manifest.files.find((file: { file: string }) => file.file.endsWith('.deb'))
                        .file,
                ),
                'corrupted package',
            )
            await rm(download, { recursive: true })
            await mkdir(download)
            await expect(
                distributionCommand([...apt, 'download', 'rentnerproxy'], { cwd: download }),
            ).rejects.toThrow()
            const badKey = join(directory, 'wrong-keyring.gpg')
            await writeFile(badKey, Buffer.alloc(1))
            await chmod(badKey, 0o644)
            await writeFile(configuration, `deb [signed-by=${badKey}] file:${root}/apt beta main\n`)
            await rm(lists, { recursive: true })
            await mkdir(lists)
            await expect(
                distributionCommand([...apt, '-o', 'APT::Update::Error-Mode=any', 'update']),
            ).rejects.toThrow()
        } finally {
            await rm(resolve(directory), { recursive: true, force: true })
        }
    },
    120_000,
)
