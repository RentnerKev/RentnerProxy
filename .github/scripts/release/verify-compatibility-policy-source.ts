import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

export const POLICY_SOURCE_ERROR = 'Release compatibility policy source verification failed.'
export const POLICY_SOURCE_PATHS = [
    'web/src/config/compatibility.config.ts',
    'web/src/lib/ApplicationVersion/legacyUpgradeContract.ts',
    'web/src/lib/ApplicationVersion/upgradeCompatibility.ts',
    'web/src/lib/ApplicationVersion/releaseVersion.ts',
] as const
const MAX_POLICY_BYTES = 65_536
const execute = promisify(execFile)
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function verifyPolicyFile(
    git: (...args: string[]) => Promise<Buffer>,
    revision: string,
    policyPath: string,
    trustedDirectory: string,
): Promise<void> {
    const object = `${revision}:${policyPath}`
    if ((await git('cat-file', '-t', object)).toString().trim() !== 'blob') throw new Error()
    const size = Number((await git('cat-file', '-s', object)).toString().trim())
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_POLICY_BYTES) throw new Error()
    const target = await git('cat-file', 'blob', object)
    const trusted = await readFile(resolve(trustedDirectory, policyPath))
    if (trusted.length < 1 || trusted.length > MAX_POLICY_BYTES || target.length !== size)
        throw new Error()
    if (digest(target) !== digest(trusted)) throw new Error()
}

export async function verifyCompatibilityPolicySource(
    sourceDirectory: string,
    revision: string,
    trustedDirectory = resolve(import.meta.dir, '../../..'),
): Promise<void> {
    try {
        if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error()
        const git = async (...args: string[]) => {
            const result = await execute(
                'git',
                ['-C', sourceDirectory, '--no-replace-objects', ...args],
                {
                    encoding: 'buffer',
                    maxBuffer: MAX_POLICY_BYTES,
                    timeout: 10_000,
                    windowsHide: true,
                },
            )
            return result.stdout
        }
        if ((await git('rev-parse', '--verify', 'HEAD')).toString().trim() !== revision)
            throw new Error()
        for (const policyPath of POLICY_SOURCE_PATHS) {
            // These reads are bounded and never import or execute target-revision modules.
            // oxlint-disable-next-line no-await-in-loop -- Validate each contract dependency before proceeding.
            await verifyPolicyFile(git, revision, policyPath, trustedDirectory)
        }
    } catch {
        throw new Error(POLICY_SOURCE_ERROR)
    }
}

if (import.meta.main) {
    try {
        const workspace = process.env.GITHUB_WORKSPACE
        if (!workspace) throw new Error()
        await verifyCompatibilityPolicySource(
            resolve(workspace, 'source'),
            process.env.RELEASE_REVISION ?? '',
        )
    } catch {
        console.error(`::error::${POLICY_SOURCE_ERROR}`)
        process.exitCode = 1
    }
}
