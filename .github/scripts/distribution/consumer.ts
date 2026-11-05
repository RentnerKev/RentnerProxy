import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { distributionFileHash } from './bundle.ts'
import { parseRepositoryCatalog } from './repository.ts'
import { distributionPackageVersion, parseDistributionRelease } from './release.ts'
import type { DistributionRelease } from './Types/distribution.types.ts'

async function consumerEntries(
    directory: string,
    platform: DistributionRelease['platform'],
    expected?: DistributionRelease,
) {
    if (expected && expected.platform !== platform)
        throw new Error('Consumer architecture does not match the requested release')
    const path = join(directory, 'catalog.json'),
        info = await lstat(path)
    if (!info.isFile() || info.nlink !== 1 || info.size > 2 * 1024 * 1024)
        throw new Error('Invalid public consumer catalog')
    const entries = parseRepositoryCatalog(JSON.parse(await readFile(path, 'utf8'))).filter(
        (entry) =>
            entry.release.platform === platform &&
            (!expected ||
                (entry.release.version === expected.version &&
                    entry.release.revision === expected.revision &&
                    entry.release.digest === expected.digest &&
                    entry.release.packageRevision === expected.packageRevision)),
    )
    if (!entries.length || (expected && entries.length !== 1))
        throw new Error('Published catalog does not contain the exact requested release')
    return entries
}

export async function consumerPackageVersion(
    directory: string,
    target: 'debian' | 'fedora',
    platform: DistributionRelease['platform'],
    expected?: DistributionRelease,
) {
    await consumerEntries(directory, platform, expected)
    if (!expected) return ''
    const version = distributionPackageVersion(expected.version, expected.packageRevision)
    return target === 'debian' ? version.debian : `${version.rpmVersion}-${version.rpmRelease}`
}

export async function verifyConsumerPackage(
    directory: string,
    target: 'debian' | 'fedora',
    platform: DistributionRelease['platform'],
    expected?: DistributionRelease,
) {
    const entries = await consumerEntries(directory, platform, expected),
        suffix = target === 'debian' ? '.deb' : '.rpm',
        paths = (await readdir(directory)).filter((path) => path.endsWith(suffix))
    if (paths.length !== 1) throw new Error('Expected one native consumer package')
    const path = join(directory, paths[0]!),
        sha256 = await distributionFileHash(path),
        info = await lstat(path)
    if (
        !entries.some((entry) =>
            entry.files.some(
                (file) =>
                    file.file.endsWith(suffix) &&
                    file.sha256 === sha256 &&
                    file.bytes === info.size,
            ),
        )
    )
        throw new Error('Downloaded package does not match the signed release catalog')
}

export async function consumerCommand(
    action: string,
    directory: string,
    env: NodeJS.ProcessEnv = process.env,
) {
    const target = env.TARGET
    if (target !== 'debian' && target !== 'fedora')
        throw new Error('Invalid native consumer target')
    const platform =
        process.arch === 'x64'
            ? 'linux/amd64'
            : process.arch === 'arm64'
              ? 'linux/arm64'
              : undefined
    if (!platform) throw new Error('Unsupported native consumer architecture')
    const fields = [env.RELEASE_VERSION, env.RELEASE_REVISION, env.RELEASE_DIGEST]
    const expected = fields.some(Boolean)
        ? parseDistributionRelease({
              schemaVersion: 1,
              version: env.RELEASE_VERSION,
              revision: env.RELEASE_REVISION,
              digest: env.RELEASE_DIGEST,
              platform,
              packageRevision: 1,
          })
        : undefined
    if (action === 'version') return consumerPackageVersion(directory, target, platform, expected)
    if (action === 'verify') {
        await verifyConsumerPackage(directory, target, platform, expected)
        return ''
    }
    throw new Error('Expected version or verify')
}

if (import.meta.main) {
    const output = await consumerCommand(process.argv[2] || '', resolve(process.argv[3] || ''))
    if (output) process.stdout.write(output + '\n')
}
