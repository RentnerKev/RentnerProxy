import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const gitBash = 'C:/Program Files/Git/bin/bash.exe'
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : Bun.which('bash')
const installer = resolve(
    import.meta.dir,
    '../../../../../.github/scripts/security/install-cargo-audit.sh',
)
const prefix = 'rentnerproxy-cargo-installer-'

function shellPath(path: string): string {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`)
        : normalized
}

for (const scenario of ['success', 'download', 'checksum', 'missing-member', 'platform', 'arch']) {
    test.skipIf(!bash)(`cargo-audit installer: ${scenario}`, async () => {
        if (!bash) throw new Error('Bash is required for installer tests.')
        const directory = await mkdtemp(join(tmpdir(), prefix))
        if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix))
            throw new Error('Unexpected installer fixture directory.')
        try {
            const tools = join(directory, 'tools')
            await mkdir(tools)
            const fixtures = {
                uname: `#!/usr/bin/env bash
if [[ "$1" == -s ]]; then
    if [[ "$SCENARIO" == platform ]]; then printf Darwin; else printf Linux; fi
elif [[ "$1" == -m ]]; then
    if [[ "$SCENARIO" == arch ]]; then printf aarch64; else printf x86_64; fi
else exit 91; fi
`,
                curl: `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'curl:%s\\n' "$*" >> "$TOOL_LOG"
if [[ "$SCENARIO" == download ]]; then exit 22; fi
while (( $# )); do
    if [[ "$1" == --output ]]; then printf fixture > "$2"; exit 0; fi
    shift
done
exit 91
`,
                sha256sum: `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'checksum\\n' >> "$TOOL_LOG"
[[ "$*" == '--check --strict' ]] || exit 91
read -r checksum archive
[[ "$checksum" == ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39 ]] || exit 91
[[ -f "$archive" ]] || exit 91
if [[ "$SCENARIO" == checksum ]]; then exit 1; fi
`,
                tar: `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'extract:%s\\n' "$*" >> "$TOOL_LOG"
[[ "$1" == -xzf && "$3" == -C && "$5" == --strip-components=1 ]] || exit 91
[[ "$6" == cargo-audit-x86_64-unknown-linux-gnu-v0.22.2/cargo-audit && "$#" == 6 ]] || exit 91
if [[ "$SCENARIO" == missing-member ]]; then exit 2; fi
printf '#!/usr/bin/env bash\\nprintf fixture-audit\\n' > "$4/cargo-audit"
`,
            }
            await Promise.all(
                Object.entries(fixtures).map(([name, source]) =>
                    writeFile(join(tools, name), source, { mode: 0o755 }),
                ),
            )
            await writeFile(join(directory, 'tools.log'), '')
            const child = Bun.spawn(
                [
                    bash,
                    '--noprofile',
                    '--norc',
                    '-c',
                    'export PATH="$TOOL_DIRECTORY:/usr/bin:/bin"; chmod +x "$TOOL_DIRECTORY"/*; exec bash "$INSTALLER"',
                ],
                {
                    cwd: directory,
                    env: {
                        PATH: '/usr/bin:/bin',
                        RUNNER_TEMP: shellPath(directory),
                        TOOL_DIRECTORY: shellPath(tools),
                        TOOL_LOG: shellPath(join(directory, 'tools.log')),
                        INSTALLER: shellPath(installer),
                        SCENARIO: scenario,
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [stdout, stderr, status] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ])
            const log = await readFile(join(directory, 'tools.log'), 'utf8')
            const installed = join(directory, 'cargo-audit/bin/cargo-audit')
            expect(status === 0, `${stdout}\n${stderr}`).toBe(scenario === 'success')
            expect(existsSync(installed)).toBe(scenario === 'success')
            expect(
                (await readdir(directory)).filter((name) =>
                    name.startsWith('cargo-audit-install.'),
                ),
            ).toEqual([])
            if (scenario === 'platform' || scenario === 'arch') {
                expect(log).toBe('')
            } else {
                expect(log).toContain('--proto =https')
                expect(log).toContain('--proto-redir =https')
                expect(log).toContain(
                    '--connect-timeout 15 --max-time 120 --retry 3 --retry-max-time 300',
                )
                expect(log).toContain(
                    'https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-x86_64-unknown-linux-gnu-v0.22.2.tgz',
                )
                expect(log.includes('checksum\n')).toBe(scenario !== 'download')
                expect(log.includes('extract:')).toBe(!['download', 'checksum'].includes(scenario))
                if (log.includes('extract:'))
                    expect(log.indexOf('checksum\n')).toBeLessThan(log.indexOf('extract:'))
            }
            if (scenario === 'success')
                expect(await readFile(installed, 'utf8')).toContain('fixture-audit')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
}
