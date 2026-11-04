// oxlint-disable no-await-in-loop -- Immutable versions are checked before repository pointers are rebuilt.
import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import {
    parseDistributionRelease,
    distributionPackageVersion,
    packageArchitecture,
} from './release.ts'
import { distributionBytes, distributionCommand } from './process.ts'
import { verifyDistributionPackage, verifyQuadletArchive } from './packages.ts'
import { ociRecord } from '../lib/oci-layout.ts'
import type { DistributionRelease } from './Types/distribution.types.ts'

interface RepositoryEntry {
    readonly release: DistributionRelease
    readonly directory: string
    readonly files: readonly {
        readonly file: string
        readonly sha256: string
        readonly bytes: number
    }[]
}

export function repositoryUrl(value: string): string {
    const url = new URL(value)
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/[A-Za-z0-9_/-]*$/u.test(url.pathname)
    )
        throw new Error('Expected a public HTTPS repository URL')
    return url.href.replace(/\/$/u, '')
}

export function signingFingerprint(value: string): string {
    if (!/^[A-F0-9]{40}$/u.test(value))
        throw new Error('Expected a pinned full OpenPGP fingerprint')
    return value
}

export function assertSigningKey(listing: string, fingerprint: string, now = Date.now()): void {
    signingFingerprint(fingerprint)
    const records = listing
        .trim()
        .split('\n')
        .map((line) => line.split(':'))
    const primary = records.filter((record) => record[0] === 'pub')
    const actual = records.find((record) => record[0] === 'fpr')?.[9]
    if (
        primary.length !== 1 ||
        actual !== fingerprint ||
        !primary[0] ||
        ['r', 'e', 'd'].includes(primary[0][1] ?? '') ||
        Number(primary[0][6]) * 1000 < now + 30 * 86_400_000 ||
        !primary[0][11]?.toLowerCase().includes('s')
    )
        throw new Error(
            'Signing key is mismatched, revoked, expired or expires in less than 30 days',
        )
}

async function regular(path: string, maximum = 16 * 1024 * 1024): Promise<Buffer> {
    const info = await lstat(path)
    if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > maximum)
        throw new Error('Invalid repository artifact')
    return readFile(path)
}

export function artifactFilename(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.length > 220 ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]+$/u.test(value) ||
        value.includes('..')
    )
        throw new Error('Invalid distribution artifact name')
    return value
}

function catalogEntry(value: unknown): RepositoryEntry {
    const raw = ociRecord(value)
    const release = parseDistributionRelease(raw.release)
    const directory = `releases/${release.version}/${release.packageRevision}/${release.platform.split('/')[1]}`
    if (
        raw.directory !== directory ||
        !Array.isArray(raw.files) ||
        raw.files.length < 3 ||
        raw.files.length > 12
    )
        throw new Error('Invalid repository catalog')
    const files = raw.files.map((candidate) => {
        const file = ociRecord(candidate)
        if (
            typeof file.sha256 !== 'string' ||
            !/^[a-f0-9]{64}$/u.test(file.sha256) ||
            typeof file.bytes !== 'number' ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 1 ||
            file.bytes > 16 * 1024 * 1024
        )
            throw new Error('Invalid catalog checksum')
        return { file: artifactFilename(file.file), sha256: file.sha256, bytes: file.bytes }
    })
    if (new Set(files.map((file) => file.file)).size !== files.length)
        throw new Error('Duplicate catalog file')
    return { release, directory, files }
}

async function fileIdentity(path: string) {
    const bytes = await regular(path)
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function readRepositoryCatalog(root: string): Promise<RepositoryEntry[]> {
    const raw: unknown = JSON.parse(
        (await regular(join(root, 'catalog.json'), 2 * 1024 * 1024)).toString('utf8'),
    )
    if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Invalid repository history')
    const entries = raw.map(catalogEntry)
    if (new Set(entries.map((entry) => entry.directory)).size !== entries.length)
        throw new Error('Duplicate immutable repository version')
    for (const entry of entries)
        for (const file of entry.files) {
            const actual = await fileIdentity(join(root, entry.directory, file.file))
            if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
                throw new Error('Repository history checksum mismatch')
        }
    return entries
}

export async function withSigningKey<T>(
    key: Uint8Array,
    fingerprint: string,
    operation: (home: string) => Promise<T>,
): Promise<T> {
    signingFingerprint(fingerprint)
    if (!key.length || key.length > 131_072) throw new Error('Invalid signing material size')
    const home = await mkdtemp(join(tmpdir(), 'rentnerproxy-signing-'))
    await chmod(home, 0o700)
    try {
        await distributionCommand(['gpg', '--homedir', home, '--batch', '--import'], { input: key })
        const listing = await distributionCommand([
            'gpg',
            '--homedir',
            home,
            '--batch',
            '--with-colons',
            '--list-keys',
            fingerprint,
        ])
        assertSigningKey(listing, fingerprint)
        return await operation(home)
    } finally {
        await distributionCommand(['gpgconf', '--homedir', home, '--kill', 'all']).catch(
            () => undefined,
        )
        await rm(home, { recursive: true, force: true })
    }
}

async function sign(home: string, fingerprint: string, path: string, clear = false) {
    await distributionCommand([
        'gpg',
        '--homedir',
        home,
        '--batch',
        '--yes',
        '--pinentry-mode',
        'error',
        '--local-user',
        fingerprint,
        '--armor',
        '--output',
        clear ? path.replace(/Release$/u, 'InRelease') : path + '.asc',
        clear ? '--clearsign' : '--detach-sign',
        path,
    ])
}

export function consumerInstructions(base: string, fingerprint: string): string {
    repositoryUrl(base)
    signingFingerprint(fingerprint)
    return `RentnerProxy complete OCI appliance — Debian 13 / Fedora 44, AMD64 / ARM64.
Requires rootful Podman >= 5.4, systemd >= 252, cgroup v2. Rootless is not supported.
The image is pinned to the assessed GHCR digest, including all bundled services.

First verify the fingerprint through the owner/release announcement independently:
${fingerprint}
curl --fail --location --proto '=https' '${base}/keys/${fingerprint}.asc' -o rentnerproxy.asc
gpg --show-keys --with-fingerprint rentnerproxy.asc
Compare the FULL fingerprint above before trusting this key. No apt-key/global trust.

Debian 13 (choose stable, beta or alpha; beta also receives stable releases):
gpg --dearmor --output rentnerproxy.gpg rentnerproxy.asc
sudo install -m 0644 rentnerproxy.gpg /usr/share/keyrings/rentnerproxy.gpg
echo 'deb [signed-by=/usr/share/keyrings/rentnerproxy.gpg] ${base}/apt beta main' | sudo tee /etc/apt/sources.list.d/rentnerproxy.list
sudo apt-get update && sudo apt-get install rentnerproxy

Fedora 44:
sudo install -m 0644 rentnerproxy.asc /etc/pki/rpm-gpg/RPM-GPG-KEY-rentnerproxy
sudo tee /etc/yum.repos.d/rentnerproxy.repo <<'REPO'
[rentnerproxy]
name=RentnerProxy beta
baseurl=${base}/rpm/beta/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-rentnerproxy
REPO
sudo dnf install rentnerproxy

First configuration / service:
sudo install -m 0600 /usr/share/rentnerproxy/appliance.env.example /etc/rentnerproxy/appliance.env
Edit that private file: PUBLIC_ORIGIN and SMTP_*. Then sudo rentnerproxy start.
sudo rentnerproxy status; sudo rentnerproxy logs
No generated unit needs systemctl enable: the Quadlet installs its boot dependency.
TCP 80/443 + UDP 443 are public; management is only http://127.0.0.1:81 (use SSH).
Use journalctl -u rentnerproxy.service if initialization/readiness fails.

Updates: make an external v4 backup first, then apt-get upgrade / dnf upgrade.
sudo install -d -m 0700 /root/rentnerproxy-backups
sudo rentnerproxy backup /root/rentnerproxy-backups
sudo rentnerproxy restore /absolute/backup --confirm-replace
An interrupted restore stays stopped; retry the SAME backup with --resume.
Deployment identity changes additionally require --allow-deployment-change.
Rollback: stop, install the exact previous signed package, restore its compatible
v4 backup, and only then start. Image-only rollback cannot rewind database changes.
Previous image/version pins are recorded privately in /var/lib/rentnerproxy-distribution.
Admin > Backups retains the existing online backup/restore contract.

Quadlet archive: verify SHA256SUMS.asc with this key, verify SHA256SUMS,
extract the versioned *-quadlet.tar.gz into an empty private directory and run
sudo bash ./install.sh; configure/start as above. Upgrades repeat with the next
verified archive. Removal: stop, remove only the installed vendor files listed
in release.json/package contents, then systemctl daemon-reload. Keep /etc and data.

Removal with apt-get remove/purge or dnf remove preserves /etc/rentnerproxy and
the rentnerproxy-data volume. Explicit data deletion while stopped:
sudo rentnerproxy purge-data --confirm-purge (BEFORE removing the CLI/package).
Existing Docker/Compose volumes are never imported/deleted automatically.
`
}

export async function updatePackageRepository(options: {
    readonly root: string
    readonly source: string
    readonly artifacts: readonly { directory: string; release: DistributionRelease }[]
    readonly home: string
    readonly fingerprint: string
    readonly baseUrl: string
    readonly now?: Date
}) {
    const { root, source, artifacts, home } = options
    const fingerprint = signingFingerprint(options.fingerprint),
        base = repositoryUrl(options.baseUrl)
    const now = options.now ?? new Date()
    await mkdir(root, { recursive: true })
    const existing = await lstat(join(root, 'catalog.json')).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
    })
    const entries = existing ? await readRepositoryCatalog(root) : []
    await mkdir(join(root, 'keys'), { recursive: true })
    const publicKey = await distributionBytes([
        'gpg',
        '--homedir',
        home,
        '--batch',
        '--armor',
        '--export',
        fingerprint,
    ])
    await writeFile(join(root, 'keys', fingerprint + '.asc'), publicKey)
    await writeFile(join(root, 'keys/rentnerproxy.asc'), publicKey)
    for (const artifact of artifacts) {
        const release = parseDistributionRelease(artifact.release)
        const manifest = ociRecord(
            JSON.parse((await regular(join(artifact.directory, 'manifest.json'))).toString('utf8')),
        )
        if (
            JSON.stringify(parseDistributionRelease(manifest.release)) !==
                JSON.stringify(release) ||
            !Array.isArray(manifest.files) ||
            manifest.files.length !== 3
        )
            throw new Error('Distribution manifest identity mismatch')
        const directory = `releases/${release.version}/${release.packageRevision}/${release.platform.split('/')[1]}`
        const previous = entries.find((entry) => entry.directory === directory)
        if (previous && JSON.stringify(previous.release) !== JSON.stringify(release))
            throw new Error('Immutable distribution version collision')
        if (!previous) await mkdir(join(root, directory), { recursive: true })
        for (const raw of manifest.files) {
            const file = ociRecord(raw),
                name = artifactFilename(file.file),
                path = join(artifact.directory, name)
            const identity = await fileIdentity(path)
            if (identity.sha256 !== file.sha256 || identity.bytes !== file.bytes)
                throw new Error('Distribution artifact checksum mismatch')
            if (name.endsWith('.deb') || name.endsWith('.rpm'))
                await verifyDistributionPackage(path, source, release)
            else if (name.endsWith('-quadlet.tar.gz'))
                await verifyQuadletArchive(path, source, release)
            else throw new Error('Unexpected distribution artifact')
            const destination = join(root, directory, name)
            if (previous) {
                if (name.endsWith('.rpm'))
                    await verifyDistributionPackage(destination, source, release)
                else if ((await fileIdentity(destination)).sha256 !== identity.sha256)
                    throw new Error('Immutable package retry mismatch')
            } else {
                await copyFile(path, destination)
                if (name.endsWith('.rpm'))
                    await distributionCommand(
                        [
                            'rpmsign',
                            '--define',
                            '_gpg_name ' + fingerprint,
                            '--define',
                            '_gpg_path ' + home,
                            '--define',
                            '__gpg /usr/bin/gpg',
                            '--define',
                            '_openpgp_sign gpg',
                            '--define',
                            '_openpgp_sign_id ' + fingerprint,
                            '--addsign',
                            destination,
                        ],
                        {
                            env: {
                                PATH: process.env.PATH,
                                HOME: home,
                                GNUPGHOME: home,
                                LC_ALL: 'C',
                            },
                        },
                    )
            }
        }
        if (!previous) {
            const files = await Promise.all(
                manifest.files.map(async (raw) => {
                    const file = artifactFilename(ociRecord(raw).file)
                    const identity = await fileIdentity(join(root, directory, file))
                    return { file, bytes: identity.bytes, sha256: identity.sha256 }
                }),
            )
            const entry = { release, directory, files }
            entries.push(entry)
            const sums = files.map((file) => file.sha256 + '  ' + file.file).join('\n') + '\n'
            await writeFile(join(root, directory, 'SHA256SUMS'), sums, { flag: 'wx' })
            await sign(home, fingerprint, join(root, directory, 'SHA256SUMS'))
            await writeFile(join(root, directory, 'release.json'), JSON.stringify(entry) + '\n', {
                flag: 'wx',
            })
            await sign(home, fingerprint, join(root, directory, 'release.json'))
        }
        await writeFile(
            join(root, directory, 'INSTALL.txt'),
            consumerInstructions(base, fingerprint),
        )
    }
    // Immutable package versions remain available; channel metadata includes every
    // eligible version so a package manager, rather than release arrival order, selects updates.
    await rm(join(root, 'apt'), { recursive: true, force: true })
    await rm(join(root, 'rpm'), { recursive: true, force: true })
    for (const channel of ['alpha', 'beta', 'stable'] as const) {
        const eligible = entries.filter((entry) => {
            const actual = distributionPackageVersion(entry.release.version).channel
            return (
                channel === 'alpha' ||
                actual === 'stable' ||
                (channel === 'beta' && actual === 'beta')
            )
        })
        const apt = join(root, 'apt'),
            suite = join(apt, 'dists', channel)
        await mkdir(join(apt, 'pool/main'), { recursive: true })
        for (const architecture of ['amd64', 'arm64']) {
            const selected = eligible.filter(
                (entry) => entry.release.platform === 'linux/' + architecture,
            )
            const packageLines: string[] = []
            for (const entry of selected)
                for (const file of entry.files.filter((candidate) =>
                    candidate.file.endsWith('.deb'),
                )) {
                    const destination = join(apt, 'pool/main', file.file)
                    await copyFile(join(root, entry.directory, file.file), destination)
                    packageLines.push(
                        await distributionCommand(
                            ['apt-ftparchive', 'packages', 'pool/main/' + file.file],
                            { cwd: apt },
                        ),
                    )
                }
            const directory = join(suite, 'main/binary-' + architecture)
            await mkdir(directory, { recursive: true })
            const contents = packageLines.join('\n')
            await writeFile(join(directory, 'Packages'), contents)
            await writeFile(join(directory, 'Packages.gz'), gzipSync(contents))
        }
        const metadata = await distributionCommand(['apt-ftparchive', 'release', '.'], {
            cwd: suite,
        })
        await writeFile(
            join(suite, 'Release'),
            `Origin: RentnerKev\nLabel: RentnerProxy\nSuite: ${channel}\nCodename: ${channel}\nArchitectures: amd64 arm64\nComponents: main\nValid-Until: ${new Date(now.getTime() + 35 * 86_400_000).toUTCString()}\n` +
                metadata,
        )
        await sign(home, fingerprint, join(suite, 'Release'), true)
        await distributionCommand([
            'gpg',
            '--homedir',
            home,
            '--batch',
            '--yes',
            '--local-user',
            fingerprint,
            '--output',
            join(suite, 'Release.gpg'),
            '--detach-sign',
            join(suite, 'Release'),
        ])
        for (const architecture of ['x86_64', 'aarch64']) {
            const directory = join(root, 'rpm', channel, architecture)
            await mkdir(join(directory, 'Packages'), { recursive: true })
            for (const entry of eligible.filter(
                (candidate) =>
                    packageArchitecture(candidate.release.platform, 'rpm') === architecture,
            ))
                for (const file of entry.files.filter((candidate) =>
                    candidate.file.endsWith('.rpm'),
                ))
                    await copyFile(
                        join(root, entry.directory, file.file),
                        join(directory, 'Packages', file.file),
                    )
            await distributionCommand([
                'createrepo_c',
                '--checksum',
                'sha256',
                '--unique-md-filenames',
                directory,
            ])
            await sign(home, fingerprint, join(directory, 'repodata/repomd.xml'))
        }
    }
    await writeFile(join(root, 'catalog.json'), JSON.stringify(entries) + '\n')
    await sign(home, fingerprint, join(root, 'catalog.json'))
    await writeFile(join(root, 'INSTALL.txt'), consumerInstructions(base, fingerprint))
    await writeFile(
        join(root, 'index.html'),
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>RentnerProxy packages</title><h1>RentnerProxy Linux appliance</h1><a href="INSTALL.txt">Installation, updates and recovery</a><p>Debian 13 / Fedora 44; AMD64 / ARM64; rootful Podman/Quadlet.</p></html>\n',
    )
    return entries
}
