import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { hashOciFile, inspectOciLayout, ociDigest, ociText } from '../lib/oci-layout.ts'
import type { NativeImageEvidence } from '../lib/Types/oci-layout.types.ts'

export async function candidateCommand(
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    maximumMs = 1_800_000,
): Promise<void> {
    const child = Bun.spawn(args, {
        cwd,
        env,
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'ignore',
        timeout: maximumMs,
    })
    if ((await child.exited) !== 0) throw new Error('Native candidate command failed')
}

export async function assertCandidateImageId(
    image: string,
    expected: string,
    cwd: string,
): Promise<void> {
    const child = Bun.spawn(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], {
        cwd,
        stdout: 'pipe',
        stderr: 'ignore',
        stdin: 'ignore',
    })
    const actual = (await new Response(child.stdout).text()).trim()
    if ((await child.exited) !== 0 || actual !== expected)
        throw new Error('Loaded native candidate image identity changed')
}

export async function buildCandidateHttp3Client(
    source: string,
    identity: { readonly revision: string },
    environment: NodeJS.ProcessEnv,
): Promise<void> {
    const scope = ociText(environment.RENTNERPROXY_SMOKE_RUN)
    const architecture = ociText(environment.IMAGE_ARCHITECTURE)
    await candidateCommand(
        [
            'docker',
            'buildx',
            'build',
            '--platform',
            'linux/' + architecture,
            '--file',
            'scripts/smoke/http3/Dockerfile',
            '--tag',
            `rentnerproxy-smoke-${scope}:http3-client`,
            '--label',
            'org.opencontainers.image.revision=' + identity.revision,
            '--label',
            'io.rentnerproxy.smoke-source=' + identity.revision,
            '--label',
            'io.rentnerproxy.smoke-run=' + scope,
            '--label',
            'io.rentnerproxy.smoke-image=http3-client',
            '--load',
            '.',
        ],
        source,
        environment,
    )
}

async function run(): Promise<void> {
    process.umask(0o077)
    const env = process.env
    const architecture = env.IMAGE_ARCHITECTURE
    if (architecture !== 'amd64' && architecture !== 'arm64')
        throw new Error('Unsupported native candidate architecture')
    if (
        process.platform !== 'linux' ||
        process.arch !== (architecture === 'amd64' ? 'x64' : 'arm64')
    )
        throw new Error('Native candidate tests require a matching host')
    const source = resolve(ociText(env.SOURCE_DIRECTORY))
    const directory = resolve(ociText(env.CANDIDATE_DIRECTORY))
    const archive = join(directory, 'candidate-image.tar')
    const layout = join(directory, 'layout')
    const identity = { revision: ociText(env.REVISION), version: ociText(env.VERSION) }
    const expectedDigest = ociDigest(env.EXPECTED_DIGEST)
    const runId = ociText(env.GITHUB_RUN_ID)
    const runAttempt = Number(env.GITHUB_RUN_ATTEMPT)
    if (!/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1)
        throw new Error('Invalid native workflow identity')
    const scope = `${runId}-${runAttempt}`
    const image = `rentnerproxy-smoke-${scope}:appliance`
    const environment = {
        ...env,
        RENTNERPROXY_SMOKE_REUSE_IMAGES: '1',
        RENTNERPROXY_SMOKE_RUN: scope,
        RUNTIME_IMAGE_PLATFORM: 'linux/' + architecture,
    }
    await candidateCommand(
        [
            'skopeo',
            'copy',
            '--all',
            '--preserve-digests',
            'oci-archive:' + archive,
            'oci:' + layout + ':candidate',
        ],
        source,
        environment,
    )
    const inspected = await inspectOciLayout(layout, identity, [architecture])
    if (inspected.digest !== expectedDigest) throw new Error('Native candidate digest mismatch')
    await candidateCommand(
        [
            'skopeo',
            'copy',
            '--override-os',
            'linux',
            '--override-arch',
            architecture,
            'oci-archive:' + archive,
            'docker-daemon:' + image,
        ],
        source,
        environment,
    )
    await assertCandidateImageId(image, inspected.imageIds.get(architecture)!, source)
    await candidateCommand(
        [process.execPath, '--no-env-file', 'install', '--frozen-lockfile'],
        source,
        environment,
    )
    await buildCandidateHttp3Client(source, identity, environment)
    try {
        await candidateCommand(
            [
                process.execPath,
                '--no-env-file',
                '--no-orphans',
                '.github/scripts/ci/production-smoke-ci.ts',
                'production',
            ],
            source,
            environment,
        )
        await candidateCommand(
            [
                process.execPath,
                '--no-env-file',
                '--no-orphans',
                '.github/scripts/ci/appliance-drain-smoke.ts',
            ],
            source,
            environment,
        )
        if (architecture === 'amd64') {
            const portable = join(directory, 'portable')
            await mkdir(portable)
            await candidateCommand(
                [
                    process.execPath,
                    '--no-env-file',
                    '--no-orphans',
                    '.github/scripts/ci/platform-backup.ts',
                    'export',
                ],
                source,
                {
                    ...environment,
                    PORTABLE_DIRECTORY: portable,
                    PORTABLE_IMAGE: image,
                    PORTABLE_MANIFEST: inspected.images.get(architecture)!.digest,
                },
            )
            await candidateCommand(
                [
                    'tar',
                    '--create',
                    '--file=' + join(directory, 'portable.tar'),
                    '--directory=' + portable,
                    'bundle.json',
                    'backup',
                ],
                source,
                environment,
            )
        }
        await assertCandidateImageId(image, inspected.imageIds.get(architecture)!, source)
        const evidence: NativeImageEvidence = {
            schemaVersion: 1,
            ...identity,
            architecture,
            digest: inspected.digest,
            manifestDigest: inspected.images.get(architecture)!.digest,
            imageId: inspected.imageIds.get(architecture)!,
            archiveSha256: (await hashOciFile(archive)).slice(7),
            runId,
            runAttempt,
            checks: 'native-appliance-and-drain',
        }
        await writeFile(join(directory, 'native.json'), JSON.stringify(evidence) + '\n', {
            flag: 'wx',
        })
        if (env.GITHUB_OUTPUT) {
            await appendFile(
                env.GITHUB_OUTPUT,
                `archive_sha256=${evidence.archiveSha256}\nevidence_sha256=${(await hashOciFile(join(directory, 'native.json'))).slice(7)}\n`,
            )
            if (architecture === 'amd64')
                await appendFile(
                    env.GITHUB_OUTPUT,
                    `portable_sha256=${(await hashOciFile(join(directory, 'portable.tar'))).slice(7)}\n`,
                )
        }
    } finally {
        await candidateCommand(
            [
                process.execPath,
                '--no-env-file',
                '.github/scripts/ci/production-smoke-ci.ts',
                'cleanup',
            ],
            source,
            environment,
        )
    }
}

if (import.meta.main) {
    try {
        await run()
    } catch {
        console.error('Native candidate functional validation failed.')
        process.exitCode = 1
    }
}
