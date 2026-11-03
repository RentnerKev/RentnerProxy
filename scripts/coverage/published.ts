import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function clearPublishedCoverage(directory: string, typescript = false): Promise<void> {
    await mkdir(directory, { recursive: true })
    const filenames = typescript
        ? ['summary.json', 'summary.md', 'coverage.json', 'sources.json']
        : ['summary.json', 'summary.md']
    await Promise.all(filenames.map((name) => rm(join(directory, name), { force: true })))
}
