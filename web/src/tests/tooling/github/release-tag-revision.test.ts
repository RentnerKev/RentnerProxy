import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { distributionCommand } from '../../../../../.github/scripts/distribution/process.ts'

test.skipIf(process.platform !== 'linux')(
    'release tag verification peels nested annotated tags and rejects moved or missing references',
    async () => {
        const root = await mkdtemp(join(tmpdir(), 'rp-tag-binding-')),
            repo = join(root, 'repo')
        const script = fileURLToPath(
            new URL(
                '../../../../../.github/scripts/release/verify-tag-revision.sh',
                import.meta.url,
            ),
        )
        const git = (...args: string[]) =>
            distributionCommand(['git', '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args])
        const verify = async (tag: string, revision: string) => {
            const child = Bun.spawn(
                [
                    'bash',
                    '-ceu',
                    'source "$1"; verify_release_tag_revision "$2" "$3" "$4"',
                    'fixture',
                    script,
                    repo,
                    tag,
                    revision,
                ],
                { cwd: root, stdout: 'ignore', stderr: 'ignore' },
            )
            return child.exited
        }
        try {
            await mkdir(repo)
            await git('init', '--quiet')
            await git('config', 'user.name', 'Release fixture')
            await git('config', 'user.email', 'fixture@example.invalid')
            await git('config', 'commit.gpgsign', 'false')
            await writeFile(join(repo, 'fixture'), 'first')
            await git('add', 'fixture')
            await git('commit', '--quiet', '-m', 'fixture')
            const first = (await git('rev-parse', 'HEAD')).trim()
            await git('tag', 'v1.0.0')
            await git('tag', '-a', 'inner', '-m', 'inner', first)
            await git('tag', '-a', 'v1.0.0-beta.3', '-m', 'outer', 'inner')
            expect(await verify('v1.0.0', first)).toBe(0)
            expect(await verify('v1.0.0-beta.3', first)).toBe(0)
            await writeFile(join(repo, 'fixture'), 'second')
            await git('commit', '--quiet', '-am', 'second')
            const second = (await git('rev-parse', 'HEAD')).trim()
            await git('tag', '--force', 'v1.0.0', second)
            expect(await verify('v1.0.0', first)).not.toBe(0)
            expect(await verify('v1.0.0', second)).toBe(0)
            expect(await verify('missing', first)).not.toBe(0)
            expect(await verify('v1.0.0*', first)).not.toBe(0)
            expect(await verify('v1.0.0', 'invalid')).not.toBe(0)
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    },
    15000,
)
