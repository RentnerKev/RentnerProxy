import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

const repositoryRoot = resolve(import.meta.dir, '../../../..')
const workflowPath = resolve(repositoryRoot, '.github/workflows/production-smokes.yml')

async function repositoryFile(path: string): Promise<string> {
    return readFile(resolve(repositoryRoot, path), 'utf8')
}

async function workflow(): Promise<string> {
    return readFile(workflowPath, 'utf8')
}

function externalActionReferences(source: string): readonly string[] {
    return [...source.matchAll(/^\s*uses:\s+([^\s]+)(?:\s+#.*)?$/gmu)].map((match) => match[1]!)
}

describe('production smokes workflow triggers and gate', () => {
    test('runs for pull requests to any base, main pushes, and manual dispatches', async () => {
        const source = await workflow()
        const document = Bun.YAML.parse(source) as { on: unknown }

        expect(source).toContain('name: Production Smokes')
        expect(document.on).toEqual({
            pull_request: null,
            push: { branches: ['main'] },
            workflow_dispatch: null,
        })
        expect(source).not.toContain('pull_request_target:')
        expect(source).not.toContain('workflow_run:')
    })

    test('exposes one stable Production Smokes check with bounded concurrency', async () => {
        const source = await workflow()
        const document = Bun.YAML.parse(source) as {
            concurrency: { group: string; 'cancel-in-progress': boolean }
            jobs: Record<
                string,
                {
                    name?: string
                    needs?: string
                    if?: string
                    steps: { env?: Record<string, string>; run?: string }[]
                }
            >
        }
        const gate = document.jobs['production-smokes']!
        expect(gate.name).toBe('Production Smokes')
        expect(gate.needs).toBe('build-runtime-images')
        expect(gate.if).toBe('${{ !cancelled() }}')
        expect(gate.steps[0]?.env?.IMAGE_BUILD_RESULT).toBe(
            '${{ needs.build-runtime-images.result }}',
        )
        expect(gate.steps[0]?.run).toBe('test "$IMAGE_BUILD_RESULT" = success')
        expect(document.concurrency.group).toBe(
            'production-smokes-${{ github.event.pull_request.number || github.ref }}',
        )
        expect(document.concurrency['cancel-in-progress']).toBeTrue()
    })
})

describe('production smokes workflow security and toolchain', () => {
    test('uses fork-safe read-only permissions and no registry mutation', async () => {
        const source = await workflow()

        expect(source).toMatch(/^permissions:\r?\n    contents: read\s*$/mu)
        expect(source).not.toMatch(/\bwrite(?:-all)?\b/u)
        expect(source).not.toMatch(/\$\{\{[^}]*\bsecrets(?:\s*\[|\.)/u)
        expect(source).not.toMatch(/\b(?:docker|buildx)\s+(?:login|push)\b/u)
        expect(source).not.toContain('--push')
        expect(source).not.toContain('actions/cache')
    })

    test('pins the established checkout, Bun and Docker actions', async () => {
        const source = await workflow()
        const references = externalActionReferences(
            [
                source,
                await repositoryFile('.github/actions/runtime-images/action.yml'),
                await repositoryFile('.github/actions/load-runtime-images/action.yml'),
            ].join('\n'),
        )

        expect(references.some((reference) => reference.startsWith('actions/checkout@'))).toBeTrue()
        expect(
            references.some((reference) => reference.startsWith('oven-sh/setup-bun@')),
        ).toBeTrue()
        for (const reference of references.filter((candidate) => !candidate.startsWith('./')))
            expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
        expect(source).toContain('persist-credentials: false')

        const packageJson = JSON.parse(await repositoryFile('package.json')) as {
            packageManager?: string
        }
        if (!packageJson.packageManager?.startsWith('bun@'))
            throw new Error('package.json must declare a Bun package manager')
        expect(source).toContain('BUN_VERSION: ' + packageJson.packageManager.slice('bun@'.length))
        expect(source).toContain('bun-version: ${{ env.BUN_VERSION }}')
        expect(source).toContain('bun install --frozen-lockfile')
    })
})

describe('production smokes workflow execution contract', () => {
    test('builds all runtime images once from committed OCI source on one builder', async () => {
        const document = Bun.YAML.parse(await workflow()) as {
            env: Record<string, string>
            jobs: {
                'production-smokes': {
                    steps: { uses?: string; run?: string; with?: Record<string, unknown> }[]
                }
            }
        }
        const steps = document.jobs['production-smokes'].steps
        const builds = steps.filter((step) => step.uses?.startsWith('docker/build-push-action@'))
        expect(builds).toHaveLength(0)
        expect(
            steps.some((step) => step.uses?.startsWith('docker/setup-buildx-action@')),
        ).toBeFalse()
        const verify = steps.findIndex((step) =>
            step.run?.endsWith('production-smoke-ci.ts verify-images'),
        )
        const load = steps.findIndex(
            (step) => step.uses === './.github/actions/load-runtime-images',
        )
        expect(load).toBeGreaterThan(-1)
        expect(verify).toBeGreaterThan(load)
        expect(document.env.DOCKER_BUILD_SUMMARY).toBe('false')
        expect(document.env.DOCKER_BUILD_RECORD_UPLOAD).toBe('false')
        expect(await workflow()).not.toContain('ACTIONS_RUNTIME_TOKEN')
        const producerSource = await repositoryFile('.github/actions/runtime-images/action.yml')
        const producer = Bun.YAML.parse(producerSource) as {
            inputs: Record<string, { default?: string }>
            runs: {
                steps: {
                    uses?: string
                    run?: string
                    if?: string
                    with?: Record<string, unknown>
                }[]
            }
        }
        expect(producerSource).toContain(
            'git archive HEAD | tar -x -C "$RUNNER_TEMP/runtime-image-source"',
        )
        expect(producerSource).toContain('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"')
        const sharedBuilds = producer.runs.steps.filter((step) =>
            step.uses?.startsWith('docker/build-push-action@'),
        )
        expect(sharedBuilds.map((step) => step.with?.file).toSorted()).toEqual([
            '${{ runner.temp }}/runtime-image-source/docker/production/Dockerfile',
            '${{ runner.temp }}/runtime-image-source/docker/proxy-runtime/Dockerfile',
            '${{ runner.temp }}/runtime-image-source/scripts/smoke/http3/Dockerfile',
        ])
        const builders = producer.runs.steps.filter((step) =>
            step.uses?.startsWith('docker/setup-buildx-action@'),
        )
        expect(builders).toHaveLength(1)
        for (const build of sharedBuilds)
            expect(producer.runs.steps.indexOf(builders[0]!)).toBeLessThan(
                producer.runs.steps.indexOf(build),
            )
        const appliance = sharedBuilds.find(
            (step) =>
                step.with?.file ===
                '${{ runner.temp }}/runtime-image-source/docker/production/Dockerfile',
        )!
        const proxy = sharedBuilds.find(
            (step) =>
                step.with?.file ===
                '${{ runner.temp }}/runtime-image-source/docker/proxy-runtime/Dockerfile',
        )!
        expect(producer.runs.steps.indexOf(appliance)).toBeLessThan(
            producer.runs.steps.indexOf(proxy),
        )
        expect(proxy.if).toContain("inputs.include_proxy_runtime == 'true'")
        expect(producer.inputs.include_proxy_runtime?.default).toBe('false')
        for (const build of sharedBuilds) {
            expect(build.with?.context).toBe('${{ runner.temp }}/runtime-image-source')
            expect(build.with?.platforms).toBe('linux/amd64')
            expect(build.with?.push).toBeFalse()
            expect(build.with?.outputs).toMatch(/^type=oci,dest=/u)
            expect(build.with?.labels).toContain(
                'org.opencontainers.image.revision=${{ github.sha }}',
            )
            expect(build.with?.labels).toContain('io.rentnerproxy.smoke-source=${{ github.sha }}')
            expect(build.with?.['cache-to']).toContain("github.event_name != 'pull_request'")
            expect(build.with?.['github-token']).toBeUndefined()
        }
        expect(sharedBuilds[0]?.with?.provenance).toBe('mode=max')
        expect(sharedBuilds[0]?.with?.sbom).toBeTrue()
        const runner = await repositoryFile('.github/scripts/ci/production-smoke-ci.ts')
        expect(runner).toContain("suite === 'prepare' ? prepareSmokeImages : verifySmokeImages")
    })

    test('consumers bind same-run artifacts to producer hashes and preserve its original attempt scope', async () => {
        const document = Bun.YAML.parse(await workflow()) as {
            jobs: Record<
                string,
                {
                    outputs?: Record<string, string>
                    env?: Record<string, string>
                    steps: { id?: string; uses?: string; with?: Record<string, string> }[]
                }
            >
        }
        const producer = document.jobs['build-runtime-images']!
        expect(
            producer.steps.find((step) => step.uses === './.github/actions/runtime-images')?.with
                ?.include_proxy_runtime,
        ).toBe('true')
        expect(
            Object.values(document.jobs)
                .flatMap((job) => job.steps)
                .filter((step) => step.uses === './.github/actions/runtime-images'),
        ).toHaveLength(1)
        for (const name of ['production-smokes', 'runtime-reliability', 'release-compatibility']) {
            const job = document.jobs[name]!
            expect(job.env?.RENTNERPROXY_SMOKE_RUN).toBe(
                '${{ needs.build-runtime-images.outputs.scope }}',
            )
            const loader = job.steps.find(
                (step) => step.uses === './.github/actions/load-runtime-images',
            )!
            for (const key of [
                'scope',
                'appliance_archive_sha256',
                'appliance_identity_sha256',
                'http3_archive_sha256',
                'http3_identity_sha256',
            ]) {
                expect(producer.outputs?.[key]).toBe('${{ steps.images.outputs.' + key + ' }}')
                expect(loader.with?.[key]).toBe(
                    '${{ needs.build-runtime-images.outputs.' + key + ' }}',
                )
            }
            if (name === 'production-smokes') {
                expect(loader.with?.include_proxy_runtime).toBe('true')
                for (const key of ['proxy_archive_sha256', 'proxy_identity_sha256']) {
                    expect(producer.outputs?.[key]).toBe('${{ steps.images.outputs.' + key + ' }}')
                    expect(loader.with?.[key]).toBe(
                        '${{ needs.build-runtime-images.outputs.' + key + ' }}',
                    )
                }
            } else {
                expect(loader.with?.include_proxy_runtime).toBeUndefined()
                expect(loader.with?.proxy_archive_sha256).toBeUndefined()
                expect(loader.with?.proxy_identity_sha256).toBeUndefined()
            }
        }
        const loaderSource = await repositoryFile('.github/actions/load-runtime-images/action.yml')
        const loader = Bun.YAML.parse(loaderSource) as {
            runs: {
                steps: {
                    uses?: string
                    if?: string
                    with?: Record<string, string>
                    env?: Record<string, string>
                    run?: string
                }[]
            }
        }
        const downloads = loader.runs.steps.filter((step) =>
            step.uses?.startsWith('actions/download-artifact@'),
        )
        expect(downloads.map((step) => step.with?.name).toSorted()).toEqual([
            'runtime-appliance-${{ inputs.scope }}',
            'runtime-http3-client-${{ inputs.scope }}',
            'runtime-proxy-runtime-${{ inputs.scope }}',
        ])
        expect(
            downloads.find((step) => step.with?.name?.startsWith('runtime-proxy-runtime-'))?.if,
        ).toContain("inputs.include_proxy_runtime == 'true'")
        for (const download of downloads) {
            expect(download.with?.['run-id']).toBeUndefined()
            expect(download.with?.['github-token']).toBeUndefined()
        }
        const loads = loader.runs.steps.filter((step) =>
            step.run?.endsWith('runtime-image-artifact.ts load'),
        )
        expect(loads).toHaveLength(3)
        expect(
            loads.find((step) => step.env?.RUNTIME_IMAGE_KIND === 'proxy-runtime')?.if,
        ).toContain("inputs.include_proxy_runtime == 'true'")
        for (const load of loads) {
            expect(load.env?.RENTNERPROXY_SMOKE_RUN).toBe('${{ inputs.scope }}')
            expect(load.env?.RUNTIME_IMAGE_ARCHIVE_SHA256).toMatch(/^\$\{\{ inputs\./u)
            expect(load.env?.RUNTIME_IMAGE_IDENTITY_SHA256).toMatch(/^\$\{\{ inputs\./u)
        }
        expect(loaderSource).not.toContain('github.run_attempt')
        expect(loaderSource).not.toContain('docker/build-push-action')
    })

    test('prepares scoped images before consumers and leaves final cleanup enabled', async () => {
        const document = Bun.YAML.parse(await workflow()) as {
            env: Record<string, string>
            jobs: { 'production-smokes': { steps: { run?: string; if?: string }[] } }
        }
        expect(document.env.RENTNERPROXY_SMOKE_REUSE_IMAGES).toBe('1')
        const steps = document.jobs['production-smokes'].steps
        const commands = steps.flatMap((step) => (step.run ? [step.run] : []))
        const prepare = commands.findIndex((command) =>
            command.endsWith('production-smoke-ci.ts verify-images'),
        )
        const proxy = commands.findIndex((command) =>
            command.endsWith('production-smoke-ci.ts proxy'),
        )
        expect(prepare).toBeGreaterThan(-1)
        expect(proxy).toBeGreaterThan(prepare)
        expect(
            commands.filter((command) => command.endsWith('production-smoke-ci.ts verify-images')),
        ).toHaveLength(1)
        expect(steps.at(-1)?.if).toBe("always() && steps.bun.outcome == 'success'")
    })
    test('runs runtime and managed backup smoke scripts as separate sequential steps', async () => {
        const source = await workflow()
        const commands = [
            'bun --no-env-file --no-orphans .github/scripts/ci/production-smoke-ci.ts proxy',
            'bun --no-env-file --no-orphans .github/scripts/ci/production-smoke-ci.ts production',
            'bun --no-env-file --no-orphans .github/scripts/ci/production-smoke-ci.ts backups',
            'bun --no-env-file --no-orphans .github/scripts/ci/production-smoke-ci.ts certificates',
            'bun --no-env-file --no-orphans .github/scripts/ci/production-smoke-ci.ts upstream-tls',
        ]
        let previous = -1

        for (const command of commands) {
            expect(
                source.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')),
            ).toHaveLength(1)
            const position = source.indexOf(command)
            expect(position).toBeGreaterThan(previous)
            previous = position
        }
    })

    test('always invokes scoped cleanup after successful Bun setup', async () => {
        const document = Bun.YAML.parse(await workflow()) as {
            jobs: Record<string, { steps: { if?: string; run?: string }[] }>
        }
        const cleanup = document.jobs['production-smokes']!.steps.find((step) =>
            step.run?.endsWith('production-smoke-ci.ts cleanup'),
        )!
        expect(cleanup.if).toBe("always() && steps.bun.outcome == 'success'")
    })

    test('maps each CI phase to the existing smoke implementation and builds production from checkout', async () => {
        const runner = await repositoryFile('.github/scripts/ci/production-smoke-ci.ts')
        const productionSmoke = await repositoryFile(
            '.github/scripts/ci/appliance-compose-smoke.ts',
        )
        const productionContext = await repositoryFile('.github/scripts/ci/appliance/context.ts')
        const productionStartup = await repositoryFile('.github/scripts/ci/appliance/startup.ts')
        const startupCommand = productionStartup.replace(/\s+/gu, ' ')
        const packageManifest = await repositoryFile('package.json')

        expect(runner).toContain("script: 'proxy:smoke'")
        expect(runner).toContain("source: '.github/scripts/ci/proxy-smoke.ts'")
        expect(runner).toContain("script: 'certificates:smoke'")
        expect(runner).toContain("source: 'scripts/smoke/certificates/run.ts'")
        expect(runner).toContain("script: 'upstream-tls:smoke'")
        expect(runner).toContain("source: 'scripts/smoke/proxy/upstream-tls.ts'")
        expect(runner).toContain("script: 'production:smoke'")
        expect(runner).toContain("source: '.github/scripts/ci/appliance-compose-smoke.ts'")
        expect(runner).toContain("script: 'backups:smoke'")
        expect(runner).toContain("source: '.github/scripts/ci/managed-backups-smoke.ts'")
        expect(packageManifest).toContain('.github/scripts/ci/appliance-compose-smoke.ts')
        expect(packageManifest).toContain('.github/scripts/ci/proxy-smoke.ts')
        expect(runner).toContain('cwd: repositoryRoot')
        expect(productionSmoke).toContain("from './appliance/context.ts'")
        expect(productionSmoke).toContain("from './appliance/startup.ts'")
        expect(productionSmoke).toContain('await createApplianceSmokeContext()')
        expect(productionSmoke).toContain('await verifyApplianceStartup(context)')
        expect(productionContext).toContain(
            "const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))",
        )
        expect(productionContext).toContain(
            "const productionDockerfile = join(repositoryRoot, 'docker', 'production', 'Dockerfile')",
        )
        expect(startupCommand).toContain("'docker', 'build'")
        expect(startupCommand).toMatch(
            /\[\s*'docker', 'build', '--tag', context\.imageTag, '--file', context\.productionDockerfile, '\.',?\s*\]/u,
        )
        expect(startupCommand).toContain("'--file', context.productionDockerfile")
        expect(startupCommand).toContain("'--tag', context.imageTag")
        expect(productionStartup).toContain('900_000')
    })
})

describe('production smokes resource safety', () => {
    test('uses a dedicated temporary root and an exact run-scope label for cleanup', async () => {
        const runner = await repositoryFile('.github/scripts/ci/production-smoke-ci.ts')
        const resources = await repositoryFile('scripts/smoke/resources.ts')

        expect(runner).toContain('tmpdir()')
        expect(runner).toContain('rentnerproxy-smokes-')
        expect(runner).toContain("from '../../../scripts/smoke/resources.ts'")
        expect(runner).toContain('SMOKE_RUN_LABEL')
        expect(runner).toContain('--filter')
        expect(runner).toContain("'label=' + SMOKE_RUN_LABEL + '=' + scope")
        expect(resources).toContain('SMOKE_RUN_LABEL')
        expect(resources).toContain('smokeRunScope')
        expect(resources).toMatch(/label/u)
        expect(runner).not.toMatch(/docker\s+system\s+prune/u)
    })

    test('keeps cleanup and diagnostics free of credential and broad-volume inspection', async () => {
        const runner = await repositoryFile('.github/scripts/ci/production-smoke-ci.ts')

        expect(runner).not.toContain('secrets.')
        expect(runner).not.toMatch(/docker\s+inspect\b/u)
        expect(runner).not.toMatch(/docker\s+volume\s+prune/u)
        expect(runner).toContain('GITHUB_STEP_SUMMARY')
    })
})
