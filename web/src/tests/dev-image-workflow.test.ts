import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'bun:test'

interface DevImageWorkflow {
    readonly on: Record<string, unknown>
    readonly concurrency: { readonly group: string; readonly 'cancel-in-progress': boolean }
    readonly jobs: {
        readonly build: {
            readonly permissions: { readonly contents: string; readonly packages: string }
            readonly steps: readonly {
                readonly id?: string
                readonly uses?: string
                readonly run?: string
                readonly with?: Record<string, string | boolean>
            }[]
        }
    }
}

const workflowPath = new URL('../../../.github/workflows/dev-image.yml', import.meta.url)

async function workflow(): Promise<DevImageWorkflow> {
    return Bun.YAML.parse(await readFile(workflowPath, 'utf8')) as DevImageWorkflow
}

describe('dev image workflow', () => {
    test('runs manually from main with serialized publishing', async () => {
        const config = await workflow()
        const steps = config.jobs.build.steps

        expect(Object.keys(config.on)).toEqual(['workflow_dispatch'])
        expect(config.concurrency).toEqual({ group: 'dev-image', 'cancel-in-progress': false })
        expect(steps[0]?.run).toContain('if [[ "$GITHUB_REF" != \'refs/heads/main\' ]]')
        expect(steps[1]?.with?.ref).toBe('refs/heads/main')
        expect(steps[1]?.with?.['persist-credentials']).toBe(false)
    })

    test('publishes only the moving dev tag from the production Dockerfile', async () => {
        const config = await workflow()
        const metadata = config.jobs.build.steps.find((step) => step.id === 'metadata')
        const build = config.jobs.build.steps.find((step) => step.id === 'build')
        const source = config.jobs.build.steps.find((step) => step.id === 'source')

        expect(String(metadata?.with?.tags).trim()).toBe('type=raw,value=dev')
        expect(metadata?.with?.flavor).toBe('latest=false')
        expect(build?.with?.context).toBe('source')
        expect(build?.with?.file).toBe('source/docker/production/Dockerfile')
        expect(build?.with?.push).toBe(true)
        expect(build?.with?.['build-args']).toContain('RENTNERPROXY_BUILD_VERSION=')
        expect(source?.run).toContain("printf 'version=dev-%.12s\\n'")
        expect(config.jobs.build.steps.some((step) => step.run?.includes('release create'))).toBe(
            false,
        )
    })

    test('uses pinned actions, narrow registry permission, and verifies the published digest', async () => {
        const config = await workflow()
        const steps = config.jobs.build.steps

        expect(config.jobs.build.permissions).toEqual({ contents: 'read', packages: 'write' })
        for (const step of steps) {
            if (step.uses) expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/u)
        }
        expect(steps.some((step) => step.run?.includes('imagetools inspect "$IMAGE:dev"'))).toBe(
            true,
        )
    })
})
