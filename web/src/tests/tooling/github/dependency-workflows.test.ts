import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')

test('assesses production OCI before registry credentials and keeps source execution out of the publisher', async () => {
    const files = await Promise.all(
        [
            'dev-image',
            'release-pipeline',
            'publish-assessed-image',
            'dependency-security',
            'build-assessed-image',
        ].map((name) => readFile(resolve(root, `.github/workflows/${name}.yml`), 'utf8')),
    )
    for (const source of [files[4]!]) {
        const parsed = Bun.YAML.parse(source) as {
            jobs: Record<
                string,
                {
                    permissions: Record<string, string>
                    steps?: { id?: string; with?: Record<string, unknown> }[]
                }
            >
        }
        expect(parsed.jobs.build?.permissions).toEqual({ contents: 'read' })
        expect(parsed.jobs.build?.steps?.find((step) => step.id === 'build')?.with?.push).toBe(
            false,
        )
        // Multiple build tags create ambiguous OCI archive roots for Skopeo.
        // Only the trusted publisher assigns the final channel/version tags.
        expect(
            parsed.jobs.build?.steps?.find((step) => step.id === 'build')?.with?.tags,
        ).toBeUndefined()
        expect(source.indexOf('Assess immutable candidate')).toBeLessThan(
            source.indexOf('Store assessed OCI candidate'),
        )
        expect(JSON.stringify(parsed.jobs.build)).not.toContain('secrets.GITHUB_TOKEN')
    }
    for (const source of files.slice(0, 2)) {
        expect(source).toContain('uses: ./.github/workflows/build-assessed-image.yml')
        expect(source).toContain('revision: ${{ needs.prepare.outputs.revision }}')
    }
    expect(files[4]).toContain('ref: ${{ github.workflow_sha }}')
    expect(files[4]).toContain('[[ "$(git -C source rev-parse HEAD)" == "$EXPECTED_REVISION" ]]')
    const publisher = files[2]!
    expect(publisher.indexOf('Independently reassess candidate')).toBeLessThan(
        publisher.indexOf('GHCR_TOKEN:'),
    )
    expect(publisher).toContain('ref: ${{ github.workflow_sha }}')
    expect(publisher).not.toContain('context: source')
    expect(publisher).not.toContain('bun install')
    const copy = await readFile(resolve(root, '.github/scripts/security/publish-image.sh'), 'utf8')
    expect(copy).toContain('sha256sum --check --strict')
    expect(copy).toContain('skopeo copy --all --preserve-digests')
    expect(copy).toContain('[[ "$published_digest" == "$EXPECTED_DIGEST" ]]')
    expect(copy.indexOf('approved "$ASSESSED_REPORT" "$IDENTITY_REPORT"')).toBeLessThan(
        copy.indexOf('skopeo login'),
    )
    expect(publisher).toContain('dependency-publish-report/assessment.json')
    // Own advisories cannot be converted into successful integration coverage.
    expect(files[0]).not.toContain('result == 3')
    expect(files[1]).not.toContain('result == 3')
    expect(publisher).not.toContain('result == 3')
    const recurring = files[3]!
    expect(recurring).toContain("cron: '17 4 * * *'")
    expect(recurring).toContain('pull_request:')
    expect(recurring).not.toContain('pull_request_target:')
    expect(recurring).not.toContain('secrets.')
    expect(recurring).toContain('rescan-dev-image.sh')
    expect(recurring).toContain('Production image dependency audit')
    expect(recurring).toContain('audit-bun.sh')
    expect(recurring).not.toContain('result == 3')
    expect(recurring).not.toContain('continue-on-error')
    for (const source of files) expect(source).not.toContain('accept_known_dev_advisories')
    const workflow = Bun.YAML.parse(recurring) as {
        on: Record<string, unknown>
        jobs: Record<string, { needs?: string; if?: string; steps?: { run?: string }[] }>
    }
    expect(Object.keys(workflow.on).toSorted()).toEqual([
        'pull_request',
        'push',
        'schedule',
        'workflow_dispatch',
    ])
    expect(workflow.jobs['locked-source']?.if).toBeUndefined()
    expect(
        workflow.jobs['locked-source']?.steps?.some((step) => step.run?.includes('audit-cargo.sh')),
    ).toBe(true)
    expect(
        workflow.jobs['locked-source']?.steps?.some((step) => step.run?.includes('audit-bun.sh')),
    ).toBe(true)
    expect(workflow.jobs['production-candidate']?.if).toBe("github.event_name != 'schedule'")
    expect(
        workflow.jobs['production-candidate']?.steps?.some((step) =>
            step.run?.includes('scan-image.sh'),
        ),
    ).toBe(true)
    expect(workflow.jobs['deployed-dev']?.needs).toBeUndefined()
    expect(workflow.jobs['deployed-dev']?.if).toBe(
        "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    )
    const integration = workflow.jobs['deployed-dev']?.steps?.find((step) =>
        step.run?.includes('rescan-dev-image.sh'),
    )?.run
    expect(integration).toBe('bash .github/scripts/security/rescan-dev-image.sh')
    expect(workflow.jobs['rescan-scope']).toBeUndefined()
})

test('audits exact source with base-revision automation outside PR configuration', async () => {
    const workflow = Bun.YAML.parse(
        await readFile(resolve(root, '.github/workflows/dependency-security.yml'), 'utf8'),
    ) as {
        permissions: Record<string, string>
        jobs: Record<
            string,
            {
                needs?: unknown
                steps: {
                    uses?: string
                    with?: Record<string, unknown>
                    env?: Record<string, string>
                    run?: string
                    'working-directory'?: string
                }[]
            }
        >
    }
    expect(workflow.permissions).toEqual({ contents: 'read' })
    for (const name of ['locked-source', 'production-candidate']) {
        const job = workflow.jobs[name]!
        expect(job.needs).toBeUndefined()
        const checkouts = job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))
        expect(checkouts).toHaveLength(2)
        expect(checkouts.find((step) => step.with?.path === 'automation')?.with).toEqual({
            'persist-credentials': false,
            path: 'automation',
            ref: '${{ github.event.pull_request.base.sha || github.workflow_sha }}',
        })
        expect(checkouts.find((step) => step.with?.path === 'source')?.with).toEqual({
            'persist-credentials': false,
            path: 'source',
            ref: '${{ github.sha }}',
        })
        for (const step of job.steps) {
            expect(step['working-directory']).toBeUndefined()
            if (!step.run) continue
            expect(step.run).not.toContain('source/.github/scripts')
            expect(step.run).not.toMatch(/\bcd\s+source\b/u)
            expect(step.run).not.toMatch(/\b(?:bun|npm|pnpm|yarn)\s+(?:install|run)\b/u)
            expect(step.run).not.toMatch(/\bcargo\s+(?:build|run|test|install)\b/u)
        }
    }
    const locked = workflow.jobs['locked-source']!
    for (const scanner of ['audit-cargo.sh', 'audit-bun.sh']) {
        const step = locked.steps.find((candidate) => candidate.run?.includes(scanner))!
        expect(step.run).toContain(`bash automation/.github/scripts/security/${scanner}`)
        expect(step.env?.AUTOMATION_DIRECTORY).toBe('automation')
        expect(step.env?.SOURCE_DIRECTORY).toBe('source')
    }
    expect(locked.steps.find((step) => step.run?.includes('audit-cargo.sh'))?.run).toContain(
        'REVISION="$(git -C source rev-parse HEAD)"',
    )
    const candidate = workflow.jobs['production-candidate']!
    const build = candidate.steps.find((step) =>
        step.uses?.startsWith('docker/build-push-action@'),
    )!
    expect(build.run).toBeUndefined()
    expect(build.with?.context).toBe('source')
    expect(build.with?.file).toBe('source/docker/production/Dockerfile')
    expect(build.with?.labels).toBe('org.opencontainers.image.revision=${{ github.sha }}')
    expect(build.with?.platforms).toBe('linux/amd64')
    expect(build.with?.push).toBe(false)
    expect(build.with?.tags).toBeUndefined()
    expect(build.with?.provenance).toBe('mode=max')
    expect(build.with?.sbom).toBe(true)
    expect(build.with?.outputs).toBe('type=oci,dest=${{ runner.temp }}/candidate-image.tar')
    expect(build.with?.['cache-from']).toBe(
        'type=gha,version=2,scope=dependency-audit-appliance-amd64-v1,timeout=2m',
    )
    expect(build.with?.['cache-to']).toBe(
        'type=gha,version=2,mode=max,scope=dependency-audit-appliance-amd64-v1,timeout=2m,ignore-error=true',
    )
    expect(JSON.stringify(build)).not.toMatch(/scope=(?:dev|release|production-smokes)/u)
    expect(
        candidate.steps.find((step) => step.run?.includes('install-dependency-tools.sh'))?.run,
    ).toBe('bash automation/.github/scripts/security/install-dependency-tools.sh')
    const scan = candidate.steps.find((step) => step.run?.includes('scan-image.sh'))!
    expect(scan.env?.AUTOMATION_DIRECTORY).toBe('automation')
    expect(scan.env?.IMAGE_SOURCE).toBe('oci-archive:${{ runner.temp }}/candidate-image.tar')
    expect(scan.run).toBe(
        'REVISION="$(git -C source rev-parse HEAD)" bash automation/.github/scripts/security/scan-image.sh',
    )
})
