import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')
const revision = 'a'.repeat(40)
const automationRevision = 'b'.repeat(40)
const workflowRef =
    'RentnerProxy/RentnerProxy/.github/workflows/release-recovery.yml@refs/heads/main'
const publishedAt = '2026-11-06T12:00:00Z'
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'

type Scenario = {
    name: string
    input?: Record<string, string>
    metadata?: Record<string, string>
    failure?: string
    accepted?: boolean
    channel?: string
    annotated?: boolean
    early?: boolean
}

const scenarios: Scenario[] = [
    { name: 'normal beta with annotated tag', accepted: true, channel: 'beta', annotated: true },
    {
        name: 'alpha',
        input: { RELEASE_TAG: 'v1.0.0-alpha.1' },
        metadata: { prerelease: 'true' },
        accepted: true,
        channel: 'alpha',
    },
    { name: 'stable', input: { RELEASE_TAG: 'v1.0.0' }, accepted: true, channel: 'stable' },
    ...[
        { GITHUB_REPOSITORY: 'attacker/RentnerProxy' },
        { GITHUB_EVENT_NAME: 'push' },
        { GITHUB_REF: 'refs/heads/feature' },
        { GITHUB_WORKFLOW_REF: workflowRef.replace('@refs/heads/main', '@refs/heads/feature') },
        { GITHUB_WORKFLOW_REF: workflowRef.replace('release-recovery.yml', 'ci.yml') },
        { RELEASE_ID: '0' },
        { RELEASE_ID: '01' },
        { RELEASE_ID: '9007199254740992' },
        { RELEASE_ID: '123\nchannel=stable' },
        { REVISION: 'a'.repeat(39) },
        { REVISION: 'A'.repeat(40) },
        { REVISION: revision + '\nchannel=stable' },
        { RELEASE_TAG: 'v1.0.0-beta.03' },
        { RELEASE_TAG: 'v1.0.0-rc.3' },
        { RELEASE_TAG: 'v1.0.0-beta.3\nchannel=stable' },
        { RELEASE_PUBLISHED_AT: '2026-02-30T12:00:00Z' },
        { RELEASE_PUBLISHED_AT: publishedAt + '\nchannel=stable' },
    ].map((input) => ({ name: `invalid input ${JSON.stringify(input)}`, input, early: true })),
    ...[
        { draft: 'true' },
        { id: '124' },
        { tag: 'v1.0.0-beta.4' },
        { published: '2026-11-06T12:01:00Z' },
        { prerelease: 'invalid' },
    ].map((metadata) => ({ name: `mismatched release ${JSON.stringify(metadata)}`, metadata })),
    { name: 'alpha must be prerelease', input: { RELEASE_TAG: 'v1.0.0-alpha.1' } },
    {
        name: 'stable cannot be prerelease',
        input: { RELEASE_TAG: 'v1.0.0' },
        metadata: { prerelease: 'true' },
    },
    { name: 'moved lightweight tag', failure: 'tag' },
    { name: 'moved annotated tag', failure: 'tag', annotated: true },
    { name: 'outside trusted main ancestry', failure: 'ancestry' },
    { name: 'checkout does not match automation revision', failure: 'automation' },
    { name: 'exact source CI fails', failure: 'ci' },
    {
        name: 'release metadata changes after CI before final identity check',
        failure: 'metadata-after-ci',
    },
    { name: 'tag moves after CI before final tag check', failure: 'tag-after-ci' },
]

test.each(scenarios)(
    'release recovery: $name',
    async (scenario) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-release-recovery-'))
        try {
            const bin = join(directory, 'bin')
            const automation = join(directory, 'automation')
            const scripts = join(automation, '.github/scripts/release')
            await Promise.all([mkdir(bin), mkdir(scripts, { recursive: true })])
            await Promise.all(
                [
                    'resolve-release-recovery.sh',
                    'validate-release-event.sh',
                    'verify-release-identity.sh',
                    'verify-tag-revision.sh',
                ].map((name) =>
                    copyFile(join(root, '.github/scripts/release', name), join(scripts, name)),
                ),
            )
            await writeFile(
                join(bin, 'gh'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == api && "$2" == 'repos/RentnerProxy/RentnerProxy/releases/123' ]]
printf 'api\\n' >> "$FIXTURE_EVENTS"
if [[ "$FIXTURE_FAILURE" == metadata-after-ci && -f "$FIXTURE_CI_PASSED" ]]; then
    printf '124\\t%s\\tfalse\\tfalse\\t%s\\n' "$FIXTURE_TAG" "$FIXTURE_PUBLISHED"
    exit
fi
printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$FIXTURE_ID" "$FIXTURE_TAG" "$FIXTURE_DRAFT" "$FIXTURE_PRERELEASE" "$FIXTURE_PUBLISHED"
`,
                { mode: 0o700 },
            )
            await writeFile(
                join(bin, 'git'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
case " $* " in
    *' check-ref-format '*) exit 0 ;;
    *' ls-remote '*)
        printf 'tag\\n' >> "$FIXTURE_EVENTS"
        target="$REVISION"
        if [[ "$FIXTURE_FAILURE" == tag ]]; then target="${'c'.repeat(40)}"; fi
        if [[ "$FIXTURE_FAILURE" == tag-after-ci && -f "$FIXTURE_CI_PASSED" ]]; then target="${'c'.repeat(40)}"; fi
        if [[ "$FIXTURE_ANNOTATED" == true ]]; then
            printf '%s\\trefs/tags/%s\\n%s\\trefs/tags/%s^{}\\n' '${'d'.repeat(40)}' "$RELEASE_TAG" "$target" "$RELEASE_TAG"
        else printf '%s\\trefs/tags/%s\\n' "$target" "$RELEASE_TAG"; fi ;;
    *' rev-parse HEAD '*)
        if [[ "$FIXTURE_FAILURE" == automation ]]; then printf '%s\\n' '${'c'.repeat(40)}'
        else printf '%s\\n' "$AUTOMATION_REVISION"; fi ;;
    *' merge-base --is-ancestor '*)
        printf 'ancestry\\n' >> "$FIXTURE_EVENTS"
        [[ "$*" == *"$REVISION $AUTOMATION_REVISION" && "$FIXTURE_FAILURE" != ancestry ]] ;;
    *) exit 9 ;;
esac
`,
                { mode: 0o700 },
            )
            await writeFile(
                join(bin, 'bun'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == --no-env-file && "$2" == */verify-exact-revision-ci.ts ]]
[[ "$RELEASE_REVISION" == "$REVISION" ]]
printf 'ci\\n' >> "$FIXTURE_EVENTS"
[[ "$FIXTURE_FAILURE" != ci ]]
: > "$FIXTURE_CI_PASSED"
`,
                { mode: 0o700 },
            )
            const events = join(directory, 'events')
            const output = join(directory, 'output')
            await Promise.all([writeFile(events, ''), writeFile(output, '')])
            const input = {
                GITHUB_REPOSITORY: 'RentnerProxy/RentnerProxy',
                GITHUB_EVENT_NAME: 'workflow_dispatch',
                GITHUB_REF: 'refs/heads/main',
                GITHUB_WORKFLOW_REF: workflowRef,
                RELEASE_ID: '123',
                RELEASE_TAG: 'v1.0.0-beta.3',
                REVISION: revision,
                RELEASE_PUBLISHED_AT: publishedAt,
                ...scenario.input,
            }
            const prefix =
                process.platform === 'win32'
                    ? 'export PATH="$(cygpath -u "$FIXTURE_BIN"):$PATH"; '
                    : 'export PATH="$FIXTURE_BIN:$PATH"; '
            const child = Bun.spawn([bash, '-c', prefix + 'exec bash "$FIXTURE_SCRIPT"'], {
                cwd: directory,
                env: {
                    ...process.env,
                    ...input,
                    AUTOMATION_DIRECTORY: automation,
                    AUTOMATION_REVISION: automationRevision,
                    GITHUB_OUTPUT: output,
                    FIXTURE_BIN: bin,
                    FIXTURE_SCRIPT: join(scripts, 'resolve-release-recovery.sh'),
                    FIXTURE_EVENTS: events,
                    FIXTURE_ID: scenario.metadata?.id ?? '123',
                    FIXTURE_TAG: scenario.metadata?.tag ?? input.RELEASE_TAG,
                    FIXTURE_DRAFT: scenario.metadata?.draft ?? 'false',
                    FIXTURE_PRERELEASE: scenario.metadata?.prerelease ?? 'false',
                    FIXTURE_PUBLISHED: scenario.metadata?.published ?? publishedAt,
                    FIXTURE_FAILURE: scenario.failure ?? '',
                    FIXTURE_ANNOTATED: String(scenario.annotated ?? false),
                    FIXTURE_CI_PASSED: join(directory, 'ci-passed'),
                },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [code, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            const outputs = await readFile(output, 'utf8')
            const calls = await readFile(events, 'utf8')
            if (scenario.accepted) {
                expect(code, stderr).toBe(0)
                expect(
                    Object.fromEntries(
                        outputs
                            .trim()
                            .split('\n')
                            .map((line) => line.split('=')),
                    ),
                ).toEqual({
                    release_id: '123',
                    release_tag: input.RELEASE_TAG,
                    revision,
                    published_at: publishedAt,
                    prerelease: scenario.metadata?.prerelease ?? 'false',
                    channel: scenario.channel,
                })
                expect(calls).toContain('tag\n')
                expect(calls).toContain('ancestry\n')
                expect(calls).toContain('ci\n')
            } else {
                expect(code, stderr).not.toBe(0)
                expect(outputs).toBe('')
                if (scenario.early) expect(calls).toBe('')
                if (scenario.failure?.endsWith('-after-ci')) {
                    expect(calls).toContain('ci\n')
                    expect(calls.match(/^api$/gm)).toHaveLength(2)
                    expect(calls.match(/^tag$/gm)).toHaveLength(
                        scenario.failure === 'tag-after-ci' ? 2 : 1,
                    )
                }
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
    10_000,
)

type Workflow = {
    on: Record<
        string,
        {
            inputs?: Record<string, { required: boolean; type: string }>
            secrets?: Record<string, { required: boolean }>
        }
    >
    jobs: Record<
        string,
        {
            if?: string
            permissions?: Record<string, string>
            environment?: string
            needs?: string | string[]
            uses?: string
            secrets?: Record<string, string>
            with?: Record<string, string>
            steps?: {
                run?: string
                uses?: string
                env?: Record<string, string>
                with?: Record<string, string>
            }[]
        }
    >
}
const workflow = async (name: string) =>
    Bun.YAML.parse(await readFile(join(root, '.github/workflows', name), 'utf8')) as Workflow

test('forwards only the named required signing secret across both reusable workflow boundaries', async () => {
    const [entry, pipeline, signer, recovery] = await Promise.all([
        workflow('release.yml'),
        workflow('release-pipeline.yml'),
        workflow('sign-distribution.yml'),
        workflow('release-recovery.yml'),
    ])
    const forwarding = { PACKAGE_SIGNING_KEY: '${{ secrets.PACKAGE_SIGNING_KEY }}' }
    expect(entry.jobs.release!.secrets).toEqual(forwarding)
    expect(entry.jobs.release!.with?.expected_revision).toBe('${{ github.sha }}')
    expect(recovery.jobs.release!.secrets).toEqual(forwarding)
    expect(pipeline.jobs['sign-distribution']!.secrets).toEqual(forwarding)
    for (const callable of [pipeline, signer]) {
        expect(Object.keys(callable.on.workflow_call!.secrets ?? {})).toEqual([
            'PACKAGE_SIGNING_KEY',
        ])
        expect(callable.on.workflow_call!.secrets?.PACKAGE_SIGNING_KEY?.required).toBeTrue()
    }
    for (const [name, job] of Object.entries(pipeline.jobs)) {
        if (name !== 'sign-distribution') expect(job.secrets).toBeUndefined()
    }
    const preflight = pipeline.jobs['signing-configuration']!
    const configured = { SIGNING_KEY_CONFIGURED: "${{ secrets.PACKAGE_SIGNING_KEY != '' }}" }
    expect(preflight.permissions).toEqual({})
    expect(preflight.environment).toBe('package-signing')
    expect(preflight.steps).toHaveLength(1)
    expect(preflight.steps![0]!.uses).toBeUndefined()
    expect(preflight.steps![0]!.env).toEqual(configured)
    expect(pipeline.jobs.building!.needs).toBe('signing-configuration')
    expect(signer.jobs.sign!.steps![0]!.env).toEqual(configured)
    expect(signer.jobs.sign!.steps!.filter((step) => step.env?.PACKAGE_SIGNING_KEY)).toHaveLength(1)
})

test('limits recovery to trusted main and routes only validated outputs through the complete pipeline', async () => {
    const recovery = await workflow('release-recovery.yml')
    expect(Object.keys(recovery.on)).toEqual(['workflow_dispatch'])
    expect(recovery.on.workflow_dispatch!.inputs).toEqual(
        Object.fromEntries(
            ['release_id', 'release_tag', 'revision', 'published_at'].map((name) => [
                name,
                expect.objectContaining({ required: true, type: 'string' }),
            ]),
        ),
    )
    const resolver = recovery.jobs.resolve!
    expect(resolver.if).toContain("github.repository == 'RentnerProxy/RentnerProxy'")
    expect(resolver.if).toContain("github.ref == 'refs/heads/main'")
    expect(
        resolver.steps?.some((step) => step.run?.includes('resolve-release-recovery.sh')),
    ).toBeTrue()
    expect(resolver.steps?.find((step) => step.with?.path === 'automation')?.with?.ref).toBe(
        '${{ github.workflow_sha }}',
    )
    expect(recovery.jobs.release!.needs).toContain('resolve')
    expect(recovery.jobs.release!.uses).toBe('./.github/workflows/release-pipeline.yml')
    for (const name of ['release_id', 'release_tag', 'published_at', 'channel', 'prerelease']) {
        expect(recovery.jobs.release!.with?.[name]).toContain(`needs.resolve.outputs.${name}`)
    }
    expect(recovery.jobs.release!.with?.expected_revision).toContain(
        'needs.resolve.outputs.revision',
    )
    const pipeline = await workflow('release-pipeline.yml')
    expect(pipeline.on.workflow_call!.inputs?.expected_revision).toMatchObject({
        required: true,
        type: 'string',
    })
    expect(pipeline.jobs.build!.needs).toContain('prepare')
    expect(pipeline.jobs['sign-distribution']!.needs).toContain('distribution')
    expect(pipeline.jobs['publish-image']!.needs).toContain('sign-distribution')
    expect(pipeline.jobs.publish!.needs).toContain('publish-distribution')
    const publicationWorkflows = await Promise.all([
        workflow('sign-distribution.yml'),
        workflow('publish-distribution.yml'),
    ])
    for (const [index, jobName] of ['sign', 'publish'].entries()) {
        const condition = publicationWorkflows[index]!.jobs[jobName]!.if!
        expect(condition).toContain(workflowRef)
        expect(condition).toContain("github.event_name == 'workflow_dispatch'")
        for (const field of ['release_id', 'release_tag', 'revision', 'published_at']) {
            expect(condition).toContain(`github.event.inputs.${field}`)
        }
    }
})

test.each(['unchanged', 'moved-after-resolution', 'missing-expectation'])(
    'preparation fences the already resolved source: %s',
    async (mode) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-recovery-prepare-'))
        try {
            const bin = join(directory, 'bin')
            const docker = join(directory, 'source/docker/production')
            const banners = join(directory, 'source/.github/assets/release-banners')
            await Promise.all([
                mkdir(bin),
                mkdir(docker, { recursive: true }),
                mkdir(banners, { recursive: true }),
            ])
            await Promise.all([
                writeFile(join(docker, 'Dockerfile'), 'FROM scratch'),
                writeFile(join(docker, 'Dockerfile.dockerignore'), '**/.env\n**/*.key\n'),
                writeFile(
                    join(banners, 'beta-release-banner.png'),
                    Buffer.from('89504e470d0a1a0a', 'hex'),
                ),
            ])
            await writeFile(
                join(bin, 'git'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
case " $* " in
    *' show-ref '*) exit 0 ;;
    *' rev-parse '*|*' rev-list '*) printf '%s\\n' "$FIXTURE_CHECKED_OUT" ;;
    *) exit 9 ;;
esac
`,
                { mode: 0o700 },
            )
            const output = join(directory, 'output')
            await writeFile(output, '')
            const prefix =
                process.platform === 'win32'
                    ? 'export PATH="$(cygpath -u "$FIXTURE_BIN"):$PATH"; '
                    : 'export PATH="$FIXTURE_BIN:$PATH"; '
            const child = Bun.spawn([bash, '-c', prefix + 'exec bash "$FIXTURE_SCRIPT"'], {
                cwd: directory,
                env: {
                    ...process.env,
                    FIXTURE_BIN: bin,
                    FIXTURE_SCRIPT: join(root, '.github/scripts/release/prepare-release-source.sh'),
                    FIXTURE_CHECKED_OUT:
                        mode === 'moved-after-resolution' ? 'c'.repeat(40) : revision,
                    EXPECTED_REVISION: mode === 'missing-expectation' ? '' : revision,
                    GITHUB_OUTPUT: output,
                    GITHUB_REPOSITORY: 'RentnerProxy/RentnerProxy',
                    RUNNER_TEMP: directory,
                    RELEASE_CHANNEL: 'beta',
                    RELEASE_TAG: 'v1.0.0-beta.3',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [code, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            if (mode === 'unchanged') {
                expect(code, stderr).toBe(0)
                expect(await readFile(output, 'utf8')).toContain(`revision=${revision}\n`)
            } else {
                expect(code, stderr).not.toBe(0)
                expect(await readFile(output, 'utf8')).toBe('')
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)
