import { appendFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
    discoverPublishedReleases,
    loadPublishedSource,
    requestedCompatibilitySources,
    selectCompatibilitySources,
} from '../../../../scripts/compatibility/source-selection.ts'
import { runSmokeProcess } from '../../../../scripts/smoke/process.ts'
import { parseReleaseVersion } from '../../../../web/src/lib/ApplicationVersion/releaseVersion.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))

export async function publishedSourceRevision(tag: string, target: string) {
    if (tag !== `v${parseReleaseVersion(tag)?.version}` || !/^[a-f0-9]{40}$/u.test(target))
        throw new Error('Invalid source or target identity')
    const resolved = await runSmokeProcess(
        ['git', 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`],
        { cwd: root, timeoutMs: 10_000 },
    )
    const revision = resolved.stdout.trim()
    if (resolved.exitCode !== 0 || resolved.timedOut || !/^[a-f0-9]{40}$/u.test(revision))
        throw new Error(`Published source tag unavailable locally: ${tag}`)
    const ancestor = await runSmokeProcess(
        ['git', 'merge-base', '--is-ancestor', revision, target],
        { cwd: root, timeoutMs: 10_000 },
    )
    if (ancestor.timedOut || (ancestor.exitCode !== 0 && ancestor.exitCode !== 1))
        throw new Error('Cannot verify published source ancestry')
    return {
        revision,
        ancestor: revision !== target && ancestor.exitCode === 0,
        isTarget: revision === target,
    }
}

if (import.meta.main) {
    const identity = await runSmokeProcess(['git', 'rev-parse', '--verify', 'HEAD'], {
        cwd: root,
        timeoutMs: 10_000,
    })
    const target = identity.stdout.trim()
    if (identity.exitCode !== 0 || identity.timedOut || !/^[a-f0-9]{40}$/u.test(target))
        throw new Error('Target source identity unavailable')
    const manifest = JSON.parse(
        await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    const discovery = { token: process.env.GH_TOKEN, signal: AbortSignal.timeout(120_000) }
    const all = await selectCompatibilitySources({
        releases: await discoverPublishedReleases(fetch, discovery),
        targetVersion: manifest.version,
        sourceRevision: (tag) => publishedSourceRevision(tag, target),
        loadSource: (release) => loadPublishedSource(release, fetch, discovery),
        signal: discovery.signal,
    })
    const selected = requestedCompatibilitySources(
        all,
        process.env.EVENT_NAME ?? '',
        process.env.REQUESTED_SOURCE ?? '',
    )
    for (const source of selected)
        console.log(
            `source_role=${source.role} source_version=${source.release?.version ?? 'fresh'} source_revision=${source.release?.revision ?? 'none'} source_digest=${source.release?.digest ?? 'none'} target_sha=${target}`,
        )
    const output = process.env.GITHUB_OUTPUT
    if (!output) throw new Error('GitHub output destination missing')
    await appendFile(
        output,
        `sources=${JSON.stringify(selected)}\ncomplete=${selected.length === all.length && (process.env.EVENT_NAME !== 'workflow_dispatch' || process.env.REQUESTED_SOURCE === 'all')}\n`,
    )
}
