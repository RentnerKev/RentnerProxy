import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApplianceCommand } from '../fixtures/Types/appliance-storage.types.ts'

export function immutableImageId(value: string): string {
    if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error('invalid target image identity')
    return value
}

export async function prepareTargetSource(command: ApplianceCommand, directory: string) {
    const revision = await command(['git', 'rev-parse', '--verify', 'HEAD'])
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision))
        throw new Error('invalid target source revision')
    if (await command(['git', 'status', '--porcelain=v1', '--untracked-files=all']))
        throw new Error('compatibility test requires a clean committed checkout')
    const context = join(directory, 'target-source')
    const archive = join(directory, 'target-source.tar')
    await mkdir(context)
    await command(['git', 'archive', '--format=tar', `--output=${archive}`, revision])
    await command(['tar', '-xf', archive, '-C', context])
    return { revision, context }
}
