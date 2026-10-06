import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const image = 'ghcr.io/example/runtime'
const manifest = 'fixture-manifest'
const digest = 'sha256:' + createHash('sha256').update(manifest).digest('hex')

async function publish(tags: string, publishedManifest = manifest) {
    const parent = join(root, 'tmp')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'publish-tags-'))
    const bin = join(directory, 'bin')
    await mkdir(bin)
    await Promise.all([
        writeFile(join(directory, 'candidate.tar'), 'fixture-archive'),
        writeFile(
            join(bin, 'skopeo'),
            `#!/bin/bash
set -eu
case "$1" in
    login) cat > /dev/null; echo login >> calls ;;
    copy) printf 'copy %s\\n' "\${!#}" >> calls ;;
    inspect)
        if [[ "\${!#}" == docker://* ]]; then
            printf 'inspect %s\\n' "\${!#}" >> calls
            printf '%s' "$PUBLISHED_MANIFEST"
        else
            printf fixture-manifest
        fi
        ;;
    *) exit 90 ;;
esac
`,
            { mode: 0o755 },
        ),
        writeFile(join(bin, 'bun'), '#!/bin/bash\necho approved >> calls\n', { mode: 0o755 }),
        writeFile(join(bin, 'jq'), '#!/bin/bash\nexit 0\n', { mode: 0o755 }),
    ])
    try {
        const child = Bun.spawn(
            [
                bash,
                '--noprofile',
                '--norc',
                join(root, '.github/scripts/security/publish-image.sh'),
            ],
            {
                cwd: directory,
                env: {
                    ...process.env,
                    PATH: bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH,
                    ARCHIVE: 'candidate.tar',
                    EXPECTED_ARCHIVE_SHA256: createHash('sha256')
                        .update('fixture-archive')
                        .digest('hex'),
                    EXPECTED_DIGEST: digest,
                    IMAGE: image,
                    IMAGE_TAGS: tags,
                    AUTOMATION_DIRECTORY: '.',
                    ASSESSED_REPORT: 'assessment.json',
                    IDENTITY_REPORT: 'identity.json',
                    RUNNER_TEMP: '.',
                    GITHUB_OUTPUT: 'output',
                    GHCR_TOKEN: 'fixture-token',
                    GHCR_USERNAME: 'fixture-user',
                    PUBLISHED_MANIFEST: publishedManifest,
                },
                stdin: 'ignore',
                stdout: 'ignore',
                stderr: 'ignore',
            },
        )
        const exit = await child.exited
        const calls = (await Bun.file(join(directory, 'calls')).exists())
            ? (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n')
            : []
        const output = (await Bun.file(join(directory, 'output')).exists())
            ? await readFile(join(directory, 'output'), 'utf8')
            : ''
        return { exit, calls, output }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

describe('image publication tag prevalidation', () => {
    test.each([
        { name: 'single dev tag', tags: 'dev', expected: ['dev'] },
        {
            name: 'two release tags with YAML trailing newline',
            tags: 'v1.0.0-beta.1\nbeta\n',
            expected: ['v1.0.0-beta.1', 'beta'],
        },
        {
            name: 'blank lines surrounding valid tags',
            tags: '\n\ndev\n\npreview\n\n',
            expected: ['dev', 'preview'],
        },
    ])(
        '$name publishes only validated tags and verifies their exact digest',
        async ({ tags, expected }) => {
            const result = await publish(tags)
            expect(result.exit).toBe(0)
            expect(result.calls).toEqual([
                'approved',
                'login',
                ...expected.flatMap((tag) => [
                    `copy docker://${image}:${tag}`,
                    `inspect docker://${image}:${tag}`,
                ]),
            ])
            expect(result.output).toBe(`digest=${digest}\n`)
        },
    )

    test.each(['', '\n\n', '   ', '\t\n', 'dev\ninvalid/tag\n'])(
        'rejects invalid tag lists before every registry operation: %j',
        async (tags) => {
            const result = await publish(tags)
            expect(result.exit).not.toBe(0)
            expect(result.calls).toEqual([])
            expect(result.output).toBe('')
        },
    )

    test('rejects a destination whose digest differs from the assessed candidate', async () => {
        const result = await publish('dev', 'changed-manifest')
        expect(result.exit).not.toBe(0)
        expect(result.calls).toEqual([
            'approved',
            'login',
            `copy docker://${image}:dev`,
            `inspect docker://${image}:dev`,
        ])
        expect(result.output).toBe('')
    })
})
