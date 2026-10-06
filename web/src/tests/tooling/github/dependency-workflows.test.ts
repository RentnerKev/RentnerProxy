import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')

test('assesses production OCI before registry credentials and keeps source execution out of the publisher', async () => {
    const files = await Promise.all(
        ['dev-image', 'release-pipeline', 'publish-assessed-image', 'dependency-security'].map(
            (name) => readFile(resolve(root, `.github/workflows/${name}.yml`), 'utf8'),
        ),
    )
    for (const source of files.slice(0, 2)) {
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
    // Reporting existing advisories on PRs never authorizes publication. Only
    // complete blocked assessments are reported; all unavailable evidence fails.
    expect(files[0]).not.toContain('result == 3')
    expect(files[1]).not.toContain('result == 3')
    expect(publisher).not.toContain('result == 3')
    const recurring = files[3]!
    expect(recurring).toContain("cron: '17 4 * * *'")
    expect(recurring).toContain('pull_request:')
    expect(recurring).not.toContain('pull_request_target:')
    expect(recurring).not.toContain('secrets.')
    expect(recurring).toContain('rescan-supported-images.sh')
    expect(recurring).toContain('Complete production image advisory assessment')
    expect(recurring).toContain('\'.verdict == "blocked"\'')
    expect(recurring).toContain('exit "$result"')
})
