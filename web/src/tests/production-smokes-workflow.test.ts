import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

const repositoryRoot = resolve(import.meta.dir, '../../..')
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
    test('runs only for main pull requests, main pushes, and manual dispatches', async () => {
        const source = await workflow()

        expect(source).toContain('name: Production Smokes')
        expect(source).toContain('pull_request:')
        expect(source).toContain('push:')
        expect(source).toContain('workflow_dispatch:')
        expect(source).toMatch(/pull_request:\r?\n\s+branches:\r?\n\s+- main/u)
        expect(source).toMatch(/push:\r?\n\s+branches:\r?\n\s+- main/u)
        expect(source).not.toContain('pull_request_target:')
        expect(source).not.toContain('workflow_run:')
    })

    test('exposes one stable Production Smokes check with bounded concurrency', async () => {
        const source = await workflow()
        const jobs = source.slice(source.indexOf('jobs:')).match(/^    [a-z][a-z0-9-]*:\s*$/gmu)

        expect(jobs).toEqual(['    production-smokes:'])
        expect(source).toContain('name: Production Smokes')
        expect(source).toContain('runs-on: ubuntu-latest')
        expect(source).toContain('timeout-minutes: 45')
        expect(source).toContain(
            'group: production-smokes-${{ github.event.pull_request.number || github.ref }}',
        )
        expect(source).toContain('cancel-in-progress: true')
    })
})

describe('production smokes workflow security and toolchain', () => {
    test('uses fork-safe read-only permissions and no registry mutation', async () => {
        const source = await workflow()

        expect(source).toMatch(/^permissions:\r?\n    contents: read\s*$/mu)
        expect(source).not.toMatch(/\bwrite(?:-all)?\b/u)
        expect(source).not.toContain('secrets.')
        expect(source).not.toMatch(/\b(?:docker|buildx)\s+(?:login|push)\b/u)
        expect(source).not.toContain('--push')
        expect(source).not.toContain('actions/cache')
        expect(source).not.toContain('upload-artifact')
    })

    test('pins the established checkout and Bun actions', async () => {
        const source = await workflow()
        const references = externalActionReferences(source)

        expect(references).toHaveLength(2)
        expect(references.some((reference) => reference.startsWith('actions/checkout@'))).toBeTrue()
        expect(
            references.some((reference) => reference.startsWith('oven-sh/setup-bun@')),
        ).toBeTrue()
        for (const reference of references) expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
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
    test('runs the four existing smoke scripts as separate sequential steps', async () => {
        const source = await workflow()
        const commands = [
            'bun --no-orphans scripts/production-smoke-ci.ts proxy',
            'bun --no-orphans scripts/production-smoke-ci.ts certificates',
            'bun --no-orphans scripts/production-smoke-ci.ts upstream-tls',
            'bun --no-orphans scripts/production-smoke-ci.ts production',
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
        const source = await workflow()

        expect(source).toContain("if: always() && steps.bun.outcome == 'success'")
        expect(source).toContain('bun scripts/production-smoke-ci.ts cleanup')
    })

    test('maps each CI phase to the existing smoke implementation and builds production from checkout', async () => {
        const runner = await repositoryFile('scripts/production-smoke-ci.ts')
        const productionSmoke = await repositoryFile('scripts/appliance-compose-smoke.ts')

        expect(runner).toContain("script: 'proxy:smoke'")
        expect(runner).toContain("source: 'proxy-smoke.ts'")
        expect(runner).toContain("script: 'certificates:smoke'")
        expect(runner).toContain("source: 'certificate-smoke.ts'")
        expect(runner).toContain("script: 'upstream-tls:smoke'")
        expect(runner).toContain("source: 'upstream-tls-smoke.ts'")
        expect(runner).toContain("script: 'production:smoke'")
        expect(runner).toContain("source: 'appliance-compose-smoke.ts'")
        expect(runner).toContain('cwd: repositoryRoot')
        expect(productionSmoke).toContain(
            "const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))",
        )
        expect(productionSmoke).toContain(
            "const productionDockerfile = join(repositoryRoot, 'docker', 'production', 'Dockerfile')",
        )
        expect(productionSmoke).toContain("['docker', 'build'")
        expect(productionSmoke).toMatch(
            /\['docker', 'build', '--tag', imageTag, '--file', productionDockerfile, '\.'\]/u,
        )
        expect(productionSmoke).toContain("'--file', productionDockerfile")
        expect(productionSmoke).toContain("'--tag', imageTag")
        expect(productionSmoke).toContain('900_000')
    })
})

describe('production smokes resource safety', () => {
    test('uses a dedicated temporary root and an exact run-scope label for cleanup', async () => {
        const runner = await repositoryFile('scripts/production-smoke-ci.ts')
        const resources = await repositoryFile('scripts/smoke-resources.ts')

        expect(runner).toContain('tmpdir()')
        expect(runner).toContain('rentnerproxy-smokes-')
        expect(runner).toContain("from './smoke-resources'")
        expect(runner).toContain('SMOKE_RUN_LABEL')
        expect(runner).toContain('--filter')
        expect(runner).toContain("'label=' + SMOKE_RUN_LABEL + '=' + scope")
        expect(resources).toContain('SMOKE_RUN_LABEL')
        expect(resources).toContain('smokeRunScope')
        expect(resources).toMatch(/label/u)
        expect(runner).not.toMatch(/docker\s+system\s+prune/u)
    })

    test('keeps cleanup and diagnostics free of credential and broad-volume inspection', async () => {
        const runner = await repositoryFile('scripts/production-smoke-ci.ts')

        expect(runner).not.toContain('secrets.')
        expect(runner).not.toMatch(/docker\s+inspect\b/u)
        expect(runner).not.toMatch(/docker\s+volume\s+prune/u)
        expect(runner).toContain('GITHUB_STEP_SUMMARY')
    })
})
