import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, test } from 'bun:test'

import { parseReleaseNotesConfig } from '../../../scripts/generate-release-notes'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const workflowDirectory = resolve(repositoryRoot, '.github/workflows')

function workflowPath(name: string): string {
    return resolve(workflowDirectory, name)
}

async function workflow(name: string): Promise<string> {
    return readFile(workflowPath(name), 'utf8')
}

describe('release workflow entry points', () => {
    test('routes published releases by their version tag through one serialized pipeline', async () => {
        const entry = await workflow('release.yml')
        expect(entry).toContain('- published')
        expect(entry).toContain('uses: ./.github/workflows/release-pipeline.yml')
        expect(entry).toContain('alpha|alpha.*) channel=alpha')
        expect(entry).toContain('beta|beta.*) channel=beta')
        expect(entry).toContain('group: release')
        expect(entry).toContain('cancel-in-progress: false')
        const oldEntries = await Promise.all(
            ['release-dev.yml', 'release-stable.yml'].map((name) =>
                access(workflowPath(name)).then(
                    () => true,
                    () => false,
                ),
            ),
        )
        expect(oldEntries).toEqual([false, false])
    })
    test('removes the old main-branch container publisher', async () => {
        const exists = await access(workflowPath('container-image.yml')).then(
            () => true,
            () => false,
        )
        expect(exists).toBeFalse()
    })
})

describe('shared release pipeline', () => {
    test('executes release validation for valid channels and rejects invalid tags and metadata', async () => {
        const pipeline = await workflow('release-pipeline.yml')
        const validation = pipeline
            .split('              run: |')[1]!
            .split('            - name: Verify authoritative release identity')[0]!
            .split('\n')
            .map((line) => line.replace(/^ {18}/, ''))
            .join('\n')
        const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
        const cases = [
            ['v1.0.0', 'stable', 'false', true],
            ['v1.0.0-alpha', 'alpha', 'true', true],
            ['v1.0.0-alpha.1', 'alpha', 'true', true],
            ['v1.0.0-beta.1', 'beta', 'true', true],
            ['v1.0.0-beta.test-alpha', 'beta', 'true', true],
            ['v1.0.0-beta.1', 'alpha', 'true', false],
            ['v1.0.0-alpha.1', 'alpha', 'false', false],
            ['v1.0.0', 'stable', 'true', false],
            ['v1.0.0-rc.1', 'stable', 'true', false],
            ['v1.0.0-alphabet.1', 'alpha', 'true', false],
            ['v1.0.0-alpha.01', 'alpha', 'true', false],
            ['v01.0.0', 'stable', 'false', false],
            ['v1.0.0+build', 'stable', 'false', false],
        ] as const
        for (const [tag, channel, prerelease, accepted] of cases) {
            const result = spawnSync(bash, ['-c', validation], {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    RELEASE_TAG: tag,
                    RELEASE_CHANNEL: channel,
                    RELEASE_PRERELEASE: prerelease,
                    RELEASE_ID: '123',
                    RELEASE_PUBLISHED_AT: '2026-09-09T12:00:00Z',
                },
            })
            expect(result.error).toBeUndefined()
            expect({ tag, accepted: result.status === 0 }).toEqual({ tag, accepted })
        }
    })

    test('loads the repository label mapping with a deterministic fallback category', async () => {
        const rawConfig: unknown = JSON.parse(
            await readFile(resolve(repositoryRoot, '.github/release-notes.json'), 'utf8'),
        )
        const config = parseReleaseNotesConfig(rawConfig)
        const mappedLabels = new Set(config.categories.flatMap((category) => category.labels))

        expect(mappedLabels.has('bug')).toBeTrue()
        expect(mappedLabels.has('enhancement')).toBeTrue()
        expect(mappedLabels.has('documentation')).toBeTrue()
        expect(mappedLabels.has('dependencies')).toBeTrue()
        expect(config.categories.some((category) => category.labels.length === 0)).toBeTrue()
    })

    test('pins every external action to a full commit SHA', async () => {
        const pipeline = await workflow('release-pipeline.yml')
        const references = [...pipeline.matchAll(/^\s*uses:\s+([^\s]+)(?:\s+#.*)?$/gm)].map(
            (match) => match[1],
        )
        expect(references.length).toBeGreaterThan(0)
        for (const reference of references) {
            expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/)
        }
    })

    test('keeps the Docker channel contract explicit and non-overlapping', async () => {
        const pipeline = await workflow('release-pipeline.yml')

        expect(pipeline).toContain('channel_tag=alpha')
        expect(pipeline).toContain('channel_tag=beta')
        expect(pipeline).not.toContain('channel_tag=dev')
        expect(pipeline).toContain('channel_tag=latest')
        expect(pipeline).toContain('type=raw,value=${{ needs.prepare.outputs.channel_tag }}')
        expect(pipeline).toContain('type=raw,value=${{ inputs.release_tag }}')
        expect(pipeline).toContain('flavor: latest=false')
        expect(pipeline).not.toContain('type=semver')
    })

    test('builds the exact tagged production source with supply-chain metadata', async () => {
        const pipeline = await workflow('release-pipeline.yml')

        expect(pipeline).toContain('ref: refs/tags/${{ inputs.release_tag }}')
        expect(pipeline).toContain('ref: ${{ github.workflow_sha }}')
        expect(pipeline).toContain('context: source')
        expect(pipeline).toContain('file: source/docker/production/Dockerfile')
        expect(pipeline).toContain(
            "dockerignore_relative='docker/production/Dockerfile.dockerignore'",
        )
        expect(pipeline).toContain('Release Dockerfile is missing or empty')
        expect(pipeline).toContain('platforms: linux/amd64')
        expect(pipeline).toContain('provenance: mode=max')
        expect(pipeline).toContain('sbom: true')
        expect(pipeline).toContain('scope=release-${{ inputs.channel }}')
        expect(pipeline).toContain('org.opencontainers.image.revision=')
        expect(pipeline).toContain('git -C source rev-list -n 1')
        expect(pipeline).toContain('"$actual_tag" != "$RELEASE_TAG"')
        expect(pipeline).toContain('git -C source show-ref --verify --quiet "$tag_ref"')
        expect(pipeline).toContain('[[ "$revision" == "$tag_revision" ]]')
    })

    test('publishes assets and the authoritative body only after image verification', async () => {
        const pipeline = await workflow('release-pipeline.yml')
        const verifyPosition = pipeline.indexOf('Verify published image tags')
        const publishJobPosition = pipeline.indexOf('name: Publish release notes')
        const uploadPosition = pipeline.indexOf('gh release upload')
        const editPosition = pipeline.indexOf('gh release edit')

        expect(verifyPosition).toBeGreaterThan(-1)
        expect(publishJobPosition).toBeGreaterThan(verifyPosition)
        expect(uploadPosition).toBeGreaterThan(publishJobPosition)
        expect(editPosition).toBeGreaterThan(uploadPosition)
        expect(pipeline).toContain('--clobber')
        expect(pipeline).toContain('--notes-file')
        expect(pipeline.match(/repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID/g)).toHaveLength(
            2,
        )
        expect(pipeline).toContain('[.id, .tag_name, .draft, .prerelease, .published_at]')
    })

    test('keeps prepared artifacts available across failed-job reruns', async () => {
        const pipeline = await workflow('release-pipeline.yml')

        expect(pipeline).toContain(
            'name: rentnerproxy-${{ inputs.channel }}-release-${{ github.run_id }}',
        )
        expect(pipeline).toContain('overwrite: true')
        expect(pipeline).toContain('retention-days: 30')
        expect(pipeline).not.toContain('github.run_attempt')
    })

    test('uses only the expected GitHub token permissions and no legacy registry settings', async () => {
        const pipeline = await workflow('release-pipeline.yml')

        expect(pipeline).toContain('contents: write')
        expect(pipeline).toContain('issues: read')
        expect(pipeline).toContain('packages: write')
        expect(pipeline).not.toContain('write-all')
        expect(pipeline).not.toContain('FORGEJO')
        expect(pipeline).not.toContain('GT_TOKEN')
        expect(pipeline).not.toContain('git.straessler.dev')
        expect(pipeline).not.toContain('DOCKERHUB')
    })

    test('uses release-specific banners and all files have PNG signatures', async () => {
        const pipeline = await workflow('release-pipeline.yml')
        const [betaBanner, stableBanner, alphaBanner] = await Promise.all([
            readFile(
                resolve(repositoryRoot, '.github/assets/release-banners/beta-release-banner.png'),
            ),
            readFile(
                resolve(repositoryRoot, '.github/assets/release-banners/new-release-banner.png'),
            ),
            readFile(
                resolve(repositoryRoot, '.github/assets/release-banners/alpha-release-banner.png'),
            ),
        ])
        const pngSignature = '89504e470d0a1a0a'

        expect(pipeline).toContain('beta-release-banner.png')
        expect(pipeline).toContain('new-release-banner.png')
        expect(pipeline).toContain('alpha-release-banner.png')
        expect(pipeline).toContain('case "$prerelease_part" in')
        expect(pipeline).toContain('alpha|alpha.*)')
        expect(betaBanner.subarray(0, 8).toString('hex')).toBe(pngSignature)
        expect(stableBanner.subarray(0, 8).toString('hex')).toBe(pngSignature)
        expect(alphaBanner.subarray(0, 8).toString('hex')).toBe(pngSignature)
    })
})
