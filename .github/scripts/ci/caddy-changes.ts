import { appendFile } from 'node:fs/promises'

// Only known presentation/documentation inputs may skip the runtime check.
// New or unfamiliar paths deliberately run Caddy until their ownership is reviewed.
export function affectsCaddy(path: string): boolean {
    if (
        ['server/', 'shared/', 'integrations/', 'config/', 'db/', 'tests/tooling/'].some((prefix) =>
            path.startsWith(`web/src/${prefix}`),
        )
    )
        return true
    if (path === 'README.md' || path.startsWith('docs/')) return false
    if (path.startsWith('web/') && /\.(?:tsx|css|svg|png|jpe?g|webp|woff2?)$/u.test(path))
        return false
    return true
}

export function changedPaths(base: string, head: string, cwd = process.cwd()): string[] {
    for (const revision of [base, head]) {
        if (!/^[a-f0-9]{40,64}$/u.test(revision)) throw new Error('Invalid comparison revision')
    }
    // Disabling rename detection exposes both the old deletion and the new addition.
    // NUL separation preserves spaces, tabs and newlines in repository paths.
    const result = Bun.spawnSync(
        ['git', 'diff', '--no-renames', '--name-only', '-z', `${base}...${head}`, '--'],
        { cwd, stdout: 'pipe', stderr: 'pipe' },
    )
    if (result.exitCode !== 0) throw new Error('Cannot resolve the Caddy change comparison')
    return result.stdout.toString().split('\0').filter(Boolean)
}

export function shouldRunCaddy(event: string, base: string, head: string, cwd?: string): boolean {
    if (event !== 'pull_request') return true
    return changedPaths(base, head, cwd).some(affectsCaddy)
}

if (import.meta.main) {
    const run = shouldRunCaddy(
        process.env.GITHUB_EVENT_NAME ?? '',
        process.env.CADDY_BASE_SHA ?? '',
        process.env.CADDY_HEAD_SHA ?? '',
    )
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
    await appendFile(process.env.GITHUB_OUTPUT, `caddy=${String(run)}\n`)
}
