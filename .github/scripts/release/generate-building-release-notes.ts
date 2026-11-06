import { join } from 'node:path'
import { renderBuildingReleaseNotes } from '../lib/release-notes.ts'

if (import.meta.main) {
    const directory = process.env.RUNNER_TEMP
    if (!directory) throw new Error('Runner temporary directory is required')
    await Bun.write(
        join(directory, 'rentnerproxy-release/building-body.md'),
        renderBuildingReleaseNotes({
            repository: process.env.GITHUB_REPOSITORY ?? '',
            tagName: process.env.RELEASE_TAG ?? '',
            bannerAssetName: 'building-banner.png',
        }),
    )
}
