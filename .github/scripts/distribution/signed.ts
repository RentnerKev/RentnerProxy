// oxlint-disable no-await-in-loop -- Verify every sealed file before replacing the staged public tree.
import { appendFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { bundleFiles, verifyDistributionBundle, writeDistributionBundle } from './bundle.ts'
import { validateRepositoryTree } from './publication.ts'
import { distributionWorkflowIdentity } from './prepare.ts'
import { repositoryUrl, signingFingerprint } from './repository.ts'
import { ociRecord, ociText } from '../lib/oci-layout.ts'

async function repositoryParent(repository: string): Promise<string> {
    const path = join(repository, '.git/rentnerproxy-parent'),
        info = await lstat(path)
    if (!info.isFile() || info.nlink !== 1 || info.size > 64)
        throw new Error('Invalid repository parent binding')
    const parent = (await readFile(path, 'utf8')).trim()
    if (!/^(?:initial|[a-f0-9]{40})$/u.test(parent))
        throw new Error('Invalid repository parent binding')
    return parent
}

function separateDirectories(source: string, target: string) {
    for (const [parent, child] of [
        [source, target],
        [target, source],
    ] as const) {
        const path = relative(resolve(parent), resolve(child))
        if (!path || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)))
            throw new Error('Overlapping signed distribution directories')
    }
}

async function publicPaths(root: string): Promise<string[]> {
    const paths = await bundleFiles(root)
    validateRepositoryTree(
        Buffer.from(
            paths.map((path) => `100644 blob ${'0'.repeat(40)}\tpublic/${path}\0`).join(''),
        ),
    )
    if (!paths.includes('catalog.json') || !paths.includes('catalog.json.asc'))
        throw new Error('Missing signed package catalog')
    return paths
}

export async function sealSignedDistribution(options: {
    repository: string
    assets: string
    output: string
    identity: ReturnType<typeof distributionWorkflowIdentity>
    fingerprint: string
    baseUrl: string
}) {
    const fingerprint = signingFingerprint(options.fingerprint),
        baseUrl = repositoryUrl(options.baseUrl)
    separateDirectories(options.repository, options.output)
    separateDirectories(options.assets, options.output)
    separateDirectories(options.repository, options.assets)
    await publicPaths(join(options.repository, 'public'))
    const parent = await repositoryParent(options.repository)
    await mkdir(options.output)
    await rename(join(options.repository, 'public'), join(options.output, 'public'))
    await rename(options.assets, join(options.output, 'assets'))
    await writeFile(join(options.output, 'repository-parent'), parent + '\n', { flag: 'wx' })
    await writeFile(
        join(options.output, 'publication.json'),
        JSON.stringify({ fingerprint, baseUrl }) + '\n',
        { flag: 'wx' },
    )
    return {
        sha256: await writeDistributionBundle(options.output, options.identity),
        fingerprint,
        baseUrl,
    }
}

export async function restoreSignedDistribution(options: {
    input: string
    repository: string
    assets: string
    expectedHash: string
    identity: ReturnType<typeof distributionWorkflowIdentity>
}) {
    separateDirectories(options.input, options.repository)
    separateDirectories(options.input, options.assets)
    separateDirectories(options.repository, options.assets)
    await verifyDistributionBundle(options.input, options.expectedHash, options.identity)
    const raw = ociRecord(
        JSON.parse(await readFile(join(options.input, 'publication.json'), 'utf8')),
    )
    const publication = {
        fingerprint: signingFingerprint(ociText(raw.fingerprint)),
        baseUrl: repositoryUrl(ociText(raw.baseUrl)),
    }
    const parent = (await readFile(join(options.input, 'repository-parent'), 'utf8')).trim()
    if (parent !== (await repositoryParent(options.repository)))
        throw new Error(
            'Repository changed since signing; rerun the signing job and its dependents',
        )
    const files = await publicPaths(join(options.input, 'public')),
        assets = await bundleFiles(join(options.input, 'assets'))
    await rm(join(options.repository, 'public'), { recursive: true, force: true })
    for (const [source, destination, paths] of [
        [join(options.input, 'public'), join(options.repository, 'public'), files],
        [join(options.input, 'assets'), options.assets, assets],
    ] as const) {
        for (const path of paths) {
            const target = join(destination, path)
            await mkdir(dirname(target), { recursive: true })
            await writeFile(target, await readFile(join(source, path)), { flag: 'wx', mode: 0o644 })
        }
    }
    return publication
}

export async function signedDistributionCommand(
    action: string,
    env: NodeJS.ProcessEnv = process.env,
) {
    const identity = distributionWorkflowIdentity(env)
    if (action === 'seal') {
        const result = await sealSignedDistribution({
            repository: resolve(ociText(env.REPOSITORY_DIRECTORY)),
            assets: resolve(ociText(env.RELEASE_ASSET_DIRECTORY)),
            output: resolve(ociText(env.SIGNED_DIRECTORY)),
            identity,
            fingerprint: ociText(env.PACKAGE_SIGNING_FINGERPRINT),
            baseUrl: ociText(env.PACKAGE_REPOSITORY_URL),
        })
        if (env.GITHUB_OUTPUT)
            await appendFile(
                env.GITHUB_OUTPUT,
                `signed_bundle_sha256=${result.sha256}\nfingerprint=${result.fingerprint}\nrepository_url=${result.baseUrl}\n`,
            )
    } else if (action === 'restore') {
        await restoreSignedDistribution({
            input: resolve(ociText(env.SIGNED_DIRECTORY)),
            repository: resolve(ociText(env.REPOSITORY_DIRECTORY)),
            assets: resolve(ociText(env.RELEASE_ASSET_DIRECTORY)),
            expectedHash: ociText(env.SIGNED_BUNDLE_SHA256),
            identity,
        })
    } else throw new Error('Expected seal or restore')
}

if (import.meta.main) await signedDistributionCommand(process.argv[2] || '')
