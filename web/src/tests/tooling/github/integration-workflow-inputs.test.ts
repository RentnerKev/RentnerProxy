import { readFile } from 'node:fs/promises'
import { expect, test } from 'bun:test'

type Trigger = { paths?: string[]; 'paths-ignore'?: string[] } | null
type Workflow = { on: Record<string, Trigger> }

async function workflow(name: string): Promise<Workflow> {
    return Bun.YAML.parse(
        await readFile(
            new URL(`../../../../../.github/workflows/${name}.yml`, import.meta.url),
            'utf8',
        ),
    ) as Workflow
}

const buildInputs = [
    '.github/scripts/ci/fixtures/upgrade-state.ts',
    '.github/scripts/security/dependency-policy.ts',
    'core/Cargo.toml',
    'core/Cargo.lock',
    'core/src/main.rs',
    'core/tests/private/server_management.rs',
    'core/caddy-modules/responsecache/go.sum',
    'web/src/server.ts',
    'web/src/db/migrate.ts',
    'web/drizzle/0000_fixture.sql',
    'web/public/favicon.svg',
    'docker/production/Dockerfile',
    'docker/production/Dockerfile.dockerignore',
    'docker-compose.yml',
    'scripts/build.ts',
    'scripts/lib/command-runner.ts',
    'scripts/backup/maintenance-commands.ts',
    'scripts/smoke/images.ts',
    '.dockerignore',
    'package.json',
    'bun.lock',
    'bunfig.toml',
    'drizzle.config.ts',
    'vite.config.ts',
    'tsconfig.json',
    'tsconfig.scripts.json',
]

test.each(['release-compatibility', 'runtime-reliability'])(
    '%s includes transitive production build and fixture inputs',
    async (name) => {
        const triggers = (await workflow(name)).on
        const paths = triggers.pull_request?.paths ?? []
        const matches = (path: string) => paths.some((pattern) => new Bun.Glob(pattern).match(path))
        for (const path of [...buildInputs, `.github/workflows/${name}.yml`]) {
            expect({ path, included: matches(path) }).toEqual({ path, included: true })
        }
        for (const path of ['README.md', 'docs/operations.md', '.github/WORKFLOWS.md']) {
            expect({ path, included: matches(path) }).toEqual({ path, included: false })
        }
        if (name === 'runtime-reliability') expect(triggers.push?.paths).toEqual(paths)
        else {
            expect(triggers.push?.paths).toBeUndefined()
            expect(triggers.push?.['paths-ignore']).toBeUndefined()
        }
    },
)

test.each([
    'ci',
    'workflow-lint',
    'gitleaks',
    'codeql',
    'dependency-review',
    'dependency-security',
    'production-smokes',
    'pr-preview-source',
])('%s keeps required PR checks independent of path filters', async (name) => {
    const triggers = (await workflow(name)).on
    expect(triggers).toHaveProperty('pull_request')
    expect(triggers.pull_request?.paths).toBeUndefined()
    expect(triggers.pull_request?.['paths-ignore']).toBeUndefined()
})
