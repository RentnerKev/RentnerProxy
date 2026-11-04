// oxlint-disable no-await-in-loop -- Test every eligible native upgrade source before sealing the portability proof.
import { appendFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
    hashOciFile,
    inspectOciLayout,
    ociArray,
    ociRecord,
    ociText,
    readOciJson,
} from '../lib/oci-layout.ts'
import { parseNativeImageEvidence, parsePortabilityEvidence } from './multiarch-image.ts'
import {
    assertCandidateImageId,
    buildCandidateHttp3Client,
    candidateCommand,
} from './candidate-runtime.ts'

async function run(): Promise<void> {
    if (process.platform !== 'linux' || process.arch !== 'arm64')
        throw new Error('Backup portability requires a native ARM64 runner')
    const env = process.env
    const identity = { revision: ociText(env.REVISION), version: ociText(env.VERSION) }
    const source = resolve(ociText(env.SOURCE_DIRECTORY))
    const directory = resolve(ociText(env.CANDIDATE_DIRECTORY))
    const runId = ociText(env.GITHUB_RUN_ID)
    const runAttempt = Number(env.GITHUB_RUN_ATTEMPT)
    if (
        (await hashOciFile(join(directory, 'arm64/candidate-image.tar'))) !==
            'sha256:' + ociText(env.ARM64_ARCHIVE_SHA256) ||
        (await hashOciFile(join(directory, 'arm64/native.json'))) !==
            'sha256:' + ociText(env.ARM64_EVIDENCE_SHA256) ||
        (await hashOciFile(join(directory, 'amd64/native.json'))) !==
            'sha256:' + ociText(env.AMD64_EVIDENCE_SHA256) ||
        (await hashOciFile(join(directory, 'amd64/portable.tar'))) !==
            'sha256:' + ociText(env.PORTABLE_SHA256)
    )
        throw new Error('Cross-architecture producer artifact checksum mismatch')
    const amd64 = parseNativeImageEvidence(
        await readOciJson(join(directory, 'amd64/native.json')),
        identity,
        'amd64',
        runId,
        runAttempt,
    )
    const arm64 = parseNativeImageEvidence(
        await readOciJson(join(directory, 'arm64/native.json')),
        identity,
        'arm64',
        runId,
        runAttempt,
    )
    const scope = `${runId}-${arm64.runAttempt}`
    const image = `rentnerproxy-smoke-${scope}:appliance`
    const environment = {
        ...env,
        RENTNERPROXY_SMOKE_REUSE_IMAGES: '1',
        RENTNERPROXY_SMOKE_RUN: scope,
        RUNTIME_IMAGE_PLATFORM: 'linux/arm64',
        COMPATIBILITY_PLATFORM: 'linux/arm64',
        IMAGE_ARCHITECTURE: 'arm64',
    }
    const layout = join(directory, 'arm64/layout')
    await candidateCommand(
        [
            'skopeo',
            'copy',
            '--all',
            '--preserve-digests',
            'oci-archive:' + join(directory, 'arm64/candidate-image.tar'),
            'oci:' + layout + ':candidate',
        ],
        source,
        environment,
    )
    const inspected = await inspectOciLayout(layout, identity, ['arm64'])
    if (
        inspected.digest !== arm64.digest ||
        inspected.images.get('arm64')?.digest !== arm64.manifestDigest ||
        inspected.imageIds.get('arm64') !== arm64.imageId
    )
        throw new Error('Portable restore target differs from native assessed candidate')
    await candidateCommand(
        [
            'skopeo',
            'copy',
            '--override-os',
            'linux',
            '--override-arch',
            'arm64',
            'oci-archive:' + join(directory, 'arm64/candidate-image.tar'),
            'docker-daemon:' + image,
        ],
        source,
        environment,
    )
    await assertCandidateImageId(image, arm64.imageId, source)
    await candidateCommand(
        [process.execPath, '--no-env-file', 'install', '--frozen-lockfile'],
        source,
        environment,
    )
    const report = join(directory, 'portability.json')
    try {
        await candidateCommand(
            [
                process.execPath,
                '--no-env-file',
                '--no-orphans',
                '.github/scripts/ci/platform-backup.ts',
                'restore',
            ],
            source,
            {
                ...environment,
                PORTABLE_IMAGE: image,
                PORTABLE_DIRECTORY: join(directory, 'restore'),
                PORTABLE_ARCHIVE: join(directory, 'amd64/portable.tar'),
                PORTABLE_MANIFEST: arm64.manifestDigest,
                SOURCE_MANIFEST: amd64.manifestDigest,
                PORTABILITY_REPORT: report,
            },
        )
        const proof = parsePortabilityEvidence(await readOciJson(report), identity)
        const output = join(directory, 'native-upgrades.txt')
        await candidateCommand(
            [
                process.execPath,
                '--no-env-file',
                '.github/scripts/ci/release-compatibility/select-sources.ts',
            ],
            source,
            {
                ...environment,
                EVENT_NAME: 'pull_request',
                REQUESTED_SOURCE: 'all',
                GITHUB_OUTPUT: output,
            },
        )
        const text = await Bun.file(output).text()
        const binding = text.split('\n').find((line) => line.startsWith('sources='))
        if (!binding) throw new Error('Missing native upgrade source selection')
        const sources = ociArray(JSON.parse(binding.slice(8)), 3).map(ociRecord)
        const upgrades = sources.filter((entry) => entry.role !== 'fresh')
        const nativeUpgradeSources: string[] = []
        if (upgrades.length) await buildCandidateHttp3Client(source, identity, environment)
        for (const entry of upgrades) {
            if (entry.role !== 'oldest' && entry.role !== 'previous')
                throw new Error('Invalid native upgrade role')
            const version = ociText(ociRecord(entry.release).version)
            await candidateCommand(
                [
                    process.execPath,
                    '--no-env-file',
                    '--no-orphans',
                    '.github/scripts/ci/release-compatibility/run.ts',
                ],
                source,
                { ...environment, COMPATIBILITY_SOURCE: JSON.stringify(entry) },
            )
            nativeUpgradeSources.push(version)
        }
        if (!nativeUpgradeSources.length)
            console.log(
                'No earlier assessed ARM64 release exists; native fresh install and AMD64 v4 backup portability were verified.',
            )
        await assertCandidateImageId(image, arm64.imageId, source)
        await writeFile(report, JSON.stringify({ ...proof, nativeUpgradeSources }) + '\n')
        if (env.GITHUB_OUTPUT)
            await appendFile(env.GITHUB_OUTPUT, `sha256=${(await hashOciFile(report)).slice(7)}\n`)
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
        console.error('Native ARM64 backup and upgrade compatibility validation failed.')
        process.exitCode = 1
    }
}
