import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')

test.each(['valid', 'absent', 'empty', 'oversized', 'invalid-name', 'invalid-png'])(
    'validates optional contributor assets before publication: %s',
    async (mode) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-release-avatar-validation-'))
        try {
            const artifacts = join(directory, 'rentnerproxy-release')
            await mkdir(artifacts)
            await Promise.all([
                writeFile(join(artifacts, 'release-body.md'), 'body'),
                writeFile(join(artifacts, 'RentnerProxy-v1.0.0-CHANGELOG.md'), 'changelog'),
                writeFile(
                    join(artifacts, 'release-banner.png'),
                    Buffer.from('89504e470d0a1a0a', 'hex'),
                ),
            ])
            if (mode !== 'absent') {
                await writeFile(
                    join(
                        artifacts,
                        mode === 'invalid-name'
                            ? 'contributor-bad_name.png'
                            : 'contributor-kevin.png',
                    ),
                    mode === 'empty'
                        ? ''
                        : mode === 'oversized'
                          ? 'x'.repeat(1048577)
                          : mode === 'invalid-png'
                            ? 'invalid'
                            : Buffer.from('89504e470d0a1a0a', 'hex'),
                )
            }
            const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
            const child = Bun.spawn(
                [bash, join(root, '.github/scripts/release/validate-release-assets.sh')],
                {
                    env: {
                        ...process.env,
                        RUNNER_TEMP: directory,
                        RELEASE_TAG: 'v1.0.0',
                        CHANGELOG_FILENAME: 'RentnerProxy-v1.0.0-CHANGELOG.md',
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [code, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            expect(code, stderr).toBe(['valid', 'absent'].includes(mode) ? 0 : 1)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)

test('building CLI creates only the public building body without a token or issue requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-building-notes-'))
    try {
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                join(root, '.github/scripts/release/generate-building-release-notes.ts'),
            ],
            {
                env: {
                    ...process.env,
                    RUNNER_TEMP: directory,
                    GITHUB_REPOSITORY: 'RentnerProxy/platform',
                    RELEASE_TAG: 'v1.0.0-beta.3',
                    RELEASE_MEDIA_REVISION: 'a'.repeat(40),
                    GITHUB_TOKEN: '',
                    GH_TOKEN: '',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
        expect(code, stderr).toBe(0)
        const body = await readFile(
            join(directory, 'rentnerproxy-release/building-body.md'),
            'utf8',
        )
        expect(body).toContain('New Version is Building')
        expect(body).toContain(
            `/${'a'.repeat(40)}/.github/assets/release-banners/building-release-banner.png`,
        )
        expect(body).not.toContain('CHANGELOG')
        expect(body).not.toContain('Contributors')
        expect(body).not.toContain('/beta-release-banner.png')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('isolates the immediate building write and generates final notes after all delivery jobs', async () => {
    const pipeline = Bun.YAML.parse(
        await readFile(join(root, '.github/workflows/release-pipeline.yml'), 'utf8'),
    ) as {
        jobs: Record<
            string,
            {
                needs?: string | string[]
                permissions: Record<string, string>
                steps?: { name: string; run?: string; with?: Record<string, string> }[]
            }
        >
    }
    const building = pipeline.jobs.building!
    expect(building.needs).toBe('signing-configuration')
    expect(building.permissions).toEqual({ contents: 'write' })
    expect(building.steps?.find((step) => step.with?.path === 'automation')?.with?.ref).toBe(
        '${{ github.workflow_sha }}',
    )
    const prepare = pipeline.jobs.prepare!
    expect(prepare.needs).toBe('building')
    expect(prepare.permissions).toEqual({ contents: 'read' })
    expect(
        prepare.steps?.some((step) => step.run?.includes('prepare-release-notes.sh')),
    ).toBeFalse()
    const publish = pipeline.jobs.publish!
    expect(publish.needs).toEqual(
        expect.arrayContaining(['prepare', 'build', 'publish-image', 'publish-distribution']),
    )
    expect(publish.permissions.issues).toBe('read')
    expect(
        publish.steps?.find((step) => step.run?.includes('prepare-release-notes.sh')),
    ).toBeDefined()
    expect(publish.steps?.at(-1)?.run).toContain('publish-release-notes.sh')
    const distribution = await readFile(
        join(root, '.github/workflows/publish-distribution.yml'),
        'utf8',
    )
    expect(distribution).toContain('needs: [publish, deploy]')
    expect(distribution).toContain('target: [debian, fedora]')
    expect(distribution).toContain('runner: [ubuntu-latest, ubuntu-24.04-arm]')
})

test.each(['success', 'stale', 'tag', 'banner', 'identity', 'delete-identity', 'delete-failure'])(
    'validates the building state before publishing its pinned media body: %s',
    async (failure) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-building-lifecycle-'))
        try {
            const bin = join(directory, 'bin')
            const scripts = join(directory, '.github/scripts/release')
            const assets = join(directory, '.github/assets/release-banners')
            await Promise.all([
                mkdir(bin),
                mkdir(scripts, { recursive: true }),
                mkdir(assets, { recursive: true }),
            ])
            await Promise.all(
                [
                    'publish-building-release.sh',
                    'validate-release-event.sh',
                    'verify-release-identity.sh',
                ].map((name) =>
                    copyFile(join(root, '.github/scripts/release', name), join(scripts, name)),
                ),
            )
            await writeFile(
                join(assets, 'building-release-banner.png'),
                failure === 'banner' ? 'invalid' : Buffer.from('89504e470d0a1a0a', 'hex'),
            )
            await writeFile(
                join(bin, 'gh'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == api ]]; then
    if [[ "$2" == --method ]]; then
        printf 'delete %s\\n' "$(basename "$4")" >> "$FIXTURE_EVENTS"
        [[ "$FIXTURE_FAILURE" != delete-failure ]]
        [[ "$4" == "repos/RentnerProxy/platform/releases/assets/11" || "$4" == "repos/RentnerProxy/platform/releases/assets/12" || "$4" == "repos/RentnerProxy/platform/releases/assets/13" || "$4" == "repos/RentnerProxy/platform/releases/assets/14" || "$4" == "repos/RentnerProxy/platform/releases/assets/15" || "$4" == "repos/RentnerProxy/platform/releases/assets/26" ]]
        exit
    elif [[ "$2" == */assets ]]; then
        [[ "$2" == 'repos/RentnerProxy/platform/releases/123/assets' ]]
        printf 'list 123\\n' >> "$FIXTURE_EVENTS"
        : > "$FIXTURE_LISTED"
        printf '21\\tRentnerProxy-v0.9.0-CHANGELOG.md\\n22\\trentnerproxy-update.json.asc\\n23\\trentnerproxy_1.0.0_amd64.deb\\n24\\trentnerproxy-1.0.0.aarch64.rpm\\n25\\tSHA256SUMS.asc\\n26\\tbuilding-banner.png\\n27\\tcontributor-kevin.png.asc\\n28\\tcontributor-INVALID.svg\\n29\\tunrelated.svg\\n'
        if [[ "$FIXTURE_FAILURE" == stale || "$FIXTURE_FAILURE" == delete-* ]]; then
            printf '13\\tRentnerProxy-v1.0.0-CHANGELOG.md\\n12\\trelease-banner.png\\n11\\trentnerproxy-update.json\\n14\\tcontributor-kevin.png\\n15\\tcontributor-legacy.svg\\n'
        fi
        exit
    fi
    [[ "$FIXTURE_FAILURE" != identity ]]
    if [[ "$FIXTURE_FAILURE" == delete-identity && -f "$FIXTURE_LISTED" ]]; then
        printf '123\\tv9.0.0\\tfalse\\tfalse\\t2026-10-22T00:00:00Z\\n'
        exit
    fi
    printf '123\\tv1.0.0\\tfalse\\tfalse\\t2026-10-22T00:00:00Z\\n'
else
    printf '%s\\n' "$2" >> "$FIXTURE_EVENTS"
    [[ "$*" == *building-banner.png* || "$*" == *building-body.md* ]]
fi
`,
                { mode: 0o700 },
            )
            await writeFile(
                join(bin, 'bun'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == --no-env-file ]]
printf 'building' > "$RUNNER_TEMP/rentnerproxy-release/building-body.md"
`,
                { mode: 0o700 },
            )
            const events = join(directory, 'events')
            await writeFile(events, '')
            const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
            const prefix =
                process.platform === 'win32'
                    ? 'export PATH="$(cygpath -u "$FIXTURE_BIN"):$PATH"; '
                    : 'export PATH="$FIXTURE_BIN:$PATH"; '
            const launch = () =>
                Bun.spawn([bash, '-c', prefix + 'exec bash "$FIXTURE_SCRIPT"'], {
                    env: {
                        ...process.env,
                        FIXTURE_BIN: bin,
                        FIXTURE_SCRIPT: join(scripts, 'publish-building-release.sh'),
                        FIXTURE_EVENTS: events,
                        FIXTURE_LISTED: join(directory, 'listed'),
                        FIXTURE_FAILURE: failure,
                        RUNNER_TEMP: directory,
                        GITHUB_REPOSITORY: 'RentnerProxy/platform',
                        RELEASE_ID: '123',
                        RELEASE_TAG: failure === 'tag' ? 'invalid-tag' : 'v1.0.0',
                        RELEASE_CHANNEL: 'stable',
                        RELEASE_PRERELEASE: 'false',
                        RELEASE_PUBLISHED_AT: '2026-10-22T00:00:00Z',
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                })
            const child = launch()
            const [code, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            expect(code, stderr).toBe(['success', 'stale'].includes(failure) ? 0 : 1)
            if (failure === 'success') {
                const repeated = launch()
                const [repeatCode, repeatError] = await Promise.all([
                    repeated.exited,
                    new Response(repeated.stderr).text(),
                ])
                expect(repeatCode, repeatError).toBe(0)
            }
            expect(await readFile(events, 'utf8')).toBe(
                failure === 'stale'
                    ? 'edit\nlist 123\ndelete 11\ndelete 26\ndelete 12\ndelete 13\ndelete 14\ndelete 15\n'
                    : failure === 'success'
                      ? 'edit\nlist 123\ndelete 26\n'.repeat(2)
                      : failure === 'delete-identity'
                        ? 'edit\nlist 123\n'
                        : failure === 'delete-failure'
                          ? 'edit\nlist 123\ndelete 11\n'
                          : '',
            )
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
    10_000,
)

test.each([
    'success',
    'no-avatars',
    'assets',
    'ci',
    'policy',
    'generate',
    'ci-recheck',
    'policy-recheck',
    'readiness',
    'identity',
    'body',
])(
    'keeps the final body behind every publication gate: %s',
    async (failure) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-release-lifecycle-'))
        try {
            const bin = join(directory, 'bin')
            const scripts = join(directory, 'scripts')
            await Promise.all([mkdir(bin), mkdir(scripts)])
            const artifactDirectory = join(directory, 'rentnerproxy-release')
            await mkdir(artifactDirectory)
            if (failure !== 'no-avatars') {
                await Promise.all(
                    ['contributor-kevin.png', 'contributor-second-user.png'].map((name) =>
                        writeFile(
                            join(artifactDirectory, name),
                            Buffer.from('89504e470d0a1a0a', 'hex'),
                        ),
                    ),
                )
            }
            await Promise.all(
                [
                    'publish-release-notes.sh',
                    'publish-release-readiness.sh',
                    'verify-release-identity.sh',
                ].map((name) =>
                    copyFile(join(root, '.github/scripts/release', name), join(scripts, name)),
                ),
            )
            await writeFile(
                join(bin, 'gh'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == api ]]; then
    printf 'identity\\n' >> "$FIXTURE_EVENTS"
    if [[ "$FIXTURE_FAILURE" == identity && -f "$FIXTURE_READY" ]]; then exit 1; fi
    printf '123\\tv1.0.0\\tfalse\\tfalse\\t2026-10-22T00:00:00Z\\n'
elif [[ "$1 $2" == 'release upload' ]]; then
    if [[ "$*" == *rentnerproxy-update.json* ]]; then
        printf 'readiness\\n' >> "$FIXTURE_EVENTS"
        [[ "$FIXTURE_FAILURE" != readiness ]]
        : > "$FIXTURE_READY"
    else
        printf 'assets\\n' >> "$FIXTURE_EVENTS"
        printf '%s\\n' "$@" > "$FIXTURE_UPLOADED"
        [[ "$FIXTURE_FAILURE" != assets ]]
        : > "$FIXTURE_ASSETS"
    fi
elif [[ "$1 $2" == 'release edit' ]]; then
    printf 'body\\n' >> "$FIXTURE_EVENTS"
    [[ "$FIXTURE_FAILURE" != body ]]
    printf 'final' > "$FIXTURE_BODY"
else exit 9; fi
`,
                { mode: 0o700 },
            )
            await writeFile(
                join(bin, 'bun'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == --no-env-file ]]
case "$2" in
    */verify-exact-revision-ci.ts)
        printf 'ci\\n' >> "$FIXTURE_EVENTS"
        [[ "$FIXTURE_FAILURE" != ci ]]
        if [[ "$FIXTURE_FAILURE" == ci-recheck && -f "$FIXTURE_ASSETS" ]]; then exit 1; fi ;;
    */verify-compatibility-policy-source.ts)
        printf 'policy\\n' >> "$FIXTURE_EVENTS"
        [[ "$FIXTURE_FAILURE" != policy ]]
        if [[ "$FIXTURE_FAILURE" == policy-recheck && -f "$FIXTURE_ASSETS" ]]; then exit 1; fi ;;
    */generate-release-readiness.ts)
        printf 'generate\\n' >> "$FIXTURE_EVENTS"
        [[ "$FIXTURE_FAILURE" != generate ]] ;;
    *) exit 9 ;;
esac
`,
                { mode: 0o700 },
            )
            const events = join(directory, 'events')
            const body = join(directory, 'body')
            await writeFile(body, 'building')
            const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
            const prefix =
                process.platform === 'win32'
                    ? 'export PATH="$(cygpath -u "$FIXTURE_BIN"):$PATH"; '
                    : 'export PATH="$FIXTURE_BIN:$PATH"; '
            const child = Bun.spawn([bash, '-c', prefix + 'exec bash "$FIXTURE_SCRIPT"'], {
                env: {
                    ...process.env,
                    FIXTURE_BIN: bin,
                    FIXTURE_SCRIPT: join(scripts, 'publish-release-notes.sh'),
                    FIXTURE_EVENTS: events,
                    FIXTURE_READY: join(directory, 'ready'),
                    FIXTURE_ASSETS: join(directory, 'assets'),
                    FIXTURE_UPLOADED: join(directory, 'uploaded'),
                    FIXTURE_BODY: body,
                    FIXTURE_FAILURE: failure,
                    RUNNER_TEMP: directory,
                    GITHUB_REPOSITORY: 'RentnerProxy/platform',
                    RELEASE_ID: '123',
                    RELEASE_TAG: 'v1.0.0',
                    RELEASE_PRERELEASE: 'false',
                    RELEASE_PUBLISHED_AT: '2026-10-22T00:00:00Z',
                    CHANGELOG_FILENAME: 'RentnerProxy-v1.0.0-CHANGELOG.md',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [code, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            const success = ['success', 'no-avatars'].includes(failure)
            expect(code, stderr).toBe(success ? 0 : 1)
            const calls = (await readFile(events, 'utf8')).trim().split('\n')
            const expected = [
                'identity',
                'identity',
                'ci',
                'identity',
                'policy',
                'generate',
                'assets',
                'identity',
                'ci',
                'identity',
                'policy',
                'generate',
                'readiness',
                'identity',
                'body',
            ]
            const stop = success
                ? expected.length
                : failure === 'identity'
                  ? expected.lastIndexOf('identity') + 1
                  : failure.endsWith('-recheck')
                    ? expected.lastIndexOf(failure.replace('-recheck', '')) + 1
                    : expected.indexOf(failure) + 1
            expect(calls).toEqual(expected.slice(0, stop))
            if (success) {
                const uploaded = await readFile(join(directory, 'uploaded'), 'utf8')
                expect(uploaded).not.toContain('contributor-*.png')
                expect(uploaded).not.toContain('contributor-')
                expect(uploaded).not.toContain('release-banner.png')
                expect(uploaded).toContain('RentnerProxy-v1.0.0-CHANGELOG.md')
            }
            expect(await readFile(body, 'utf8')).toBe(success ? 'final' : 'building')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
    10_000,
)
