// oxlint-disable no-await-in-loop -- Package inputs and metadata are verified in a fixed order.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
    distributionPayload,
    packagePreinstall,
    packagePostinstall,
    packageStop,
    packageRemoved,
} from './payload.ts'
import {
    distributionPackageVersion,
    packageArchitecture,
    parseDistributionRelease,
} from './release.ts'
import { distributionBytes, distributionCommand } from './process.ts'
import { assertPackageFiles, packageCpio, packageTar } from './archive.ts'
import type { DistributionPayloadFile, DistributionRelease } from './Types/distribution.types.ts'

const debDependencies = 'bash, coreutils, nftables, util-linux, podman (>= 5.4), systemd (>= 252)'
const packageOwnershipGuard =
    'if command -v dpkg-query >/dev/null && dpkg-query --search /usr/bin/rentnerproxy >/dev/null 2>&1; then echo "Use apt-get to manage rentnerproxy." >&2; exit 1; fi\n' +
    'if command -v rpm >/dev/null && rpm -qf /usr/bin/rentnerproxy >/dev/null 2>&1; then echo "Use dnf to manage rentnerproxy." >&2; exit 1; fi\n'
const debPrerm =
    '#!/bin/bash\nset -eu\nif [[ ${1:-} == remove ]]; then\n' +
    packageStop.split('\n').slice(2).join('\n') +
    'fi\n'
const debPostrm =
    '#!/bin/bash\nset -eu\ncase ${1:-} in remove|purge)\n' +
    packageRemoved.split('\n').slice(2).join('\n') +
    ';; esac\n'

export function quadletInstaller(payload: readonly DistributionPayloadFile[]): string {
    return (
        '#!/bin/bash\nset -eu\n[[ $(id -u) == 0 ]] || exit 1\n' +
        packageOwnershipGuard +
        'here=$(cd -- "$(dirname -- "$0")" && pwd)\n' +
        packagePreinstall.split('\n').slice(1).join('\n') +
        payload
            .map(
                (file) =>
                    `install -D -m ${file.mode.toString(8)} -- "$here/${file.path}" "/${file.path}"`,
            )
            .join('\n') +
        '\n' +
        packagePostinstall.split('\n').slice(1).join('\n')
    )
}

export function quadletUninstaller(payload: readonly DistributionPayloadFile[]): string {
    const checks = payload
        .map((file) => {
            const path = '/' + file.path,
                checksum = createHash('sha256').update(file.content).digest('hex')
            return `if [[ -e ${path} || -L ${path} ]]; then\n    [[ -f ${path} && ! -L ${path} ]] || exit 1\n    printf '%s\\n' '${checksum}  ${path}' | sha256sum --check --status\nfi\n`
        })
        .join('')
    return (
        '#!/bin/bash\nset -eu\n[[ $(id -u) == 0 ]] || exit 1\n' +
        packageOwnershipGuard +
        checks +
        'if [[ -d /run/systemd/system ]] && systemctl cat rentnerproxy.service >/dev/null 2>&1; then\n    if [[ -x /usr/bin/rentnerproxy ]]; then /usr/bin/rentnerproxy stop\n    elif systemctl is-active --quiet rentnerproxy.service; then echo "Restore the matching CLI before stopping the active appliance." >&2; exit 1\n    fi\nfi\n' +
        payload.map((file) => 'rm -f -- /' + file.path).join('\n') +
        '\nif [[ -d /run/systemd/system ]]; then systemctl daemon-reload; fi\n'
    )
}

export async function verifyQuadletArchive(
    path: string,
    source: string,
    identity: DistributionRelease,
): Promise<void> {
    const payload = await distributionPayload(source, identity)
    assertPackageFiles(
        packageTar(gunzipSync(await readFile(path), { maxOutputLength: 4 * 1024 * 1024 })),
        [
            ...payload,
            { path: 'install.sh', mode: 0o755, content: quadletInstaller(payload) },
            { path: 'uninstall.sh', mode: 0o755, content: quadletUninstaller(payload) },
        ],
    )
}

export function debControl(identity: DistributionRelease): readonly DistributionPayloadFile[] {
    const release = parseDistributionRelease(identity)
    return [
        {
            path: 'control',
            mode: 0o644,
            content: `Package: rentnerproxy\nVersion: ${distributionPackageVersion(release.version, release.packageRevision).debian}\nArchitecture: ${packageArchitecture(release.platform, 'deb')}\nMaintainer: RentnerKev <noreply@github.com>\nSection: net\nPriority: optional\nDepends: ${debDependencies}\nHomepage: https://github.com/RentnerProxy/platform\nDescription: Complete RentnerProxy OCI appliance managed by rootful Podman/Quadlet\n Includes web, controller, Caddy, CrowdSec, PostgreSQL and Valkey in the\n assessed GHCR image. Requires cgroup v2 and systemd; management is loopback-only.\n`,
        },
        { path: 'preinst', mode: 0o755, content: packagePreinstall },
        { path: 'postinst', mode: 0o755, content: packagePostinstall },
        { path: 'prerm', mode: 0o755, content: debPrerm },
        { path: 'postrm', mode: 0o755, content: debPostrm },
    ]
}

export function rpmSpec(
    release: DistributionRelease,
    payload: readonly DistributionPayloadFile[],
): string {
    const version = distributionPackageVersion(release.version, release.packageRevision)
    return `Name: rentnerproxy\nVersion: ${version.rpmVersion}\nRelease: ${version.rpmRelease}\nSummary: Complete RentnerProxy OCI appliance managed by rootful Podman/Quadlet\nLicense: MIT\nURL: https://github.com/RentnerProxy/platform\nAutoReqProv: no\nRequires: bash, coreutils, util-linux, podman >= 5.4, systemd >= 252\n%description\nComplete web/controller/Caddy/CrowdSec/PostgreSQL/Valkey appliance from assessed GHCR.\nRequires rootful Podman, cgroup v2 and systemd. Management is loopback-only.\n%install\nmkdir -p %{buildroot}\ncp -a %{_sourcedir}/payload/. %{buildroot}/\n%pre -p /bin/bash\n${packagePreinstall.split('\n').slice(1).join('\n').replaceAll('%', '%%')}\n%post -p /bin/bash\n${packagePostinstall.split('\n').slice(1).join('\n').replaceAll('%', '%%')}\n%preun -p /bin/bash\nif [[ $1 == 0 ]]; then\n${packageStop.split('\n').slice(1).join('\n')}fi\n%postun -p /bin/bash\nif [[ $1 == 0 ]]; then\n${packageRemoved.split('\n').slice(1).join('\n')}fi\n%files\n${payload.map((file) => `%attr(${file.mode.toString(8)},root,root) /${file.path}`).join('\n')}\n`
}

async function materialize(root: string, files: readonly DistributionPayloadFile[]) {
    for (const file of files) {
        const path = join(root, file.path)
        await mkdir(join(path, '..'), { recursive: true })
        await writeFile(path, file.content, { mode: file.mode, flag: 'wx' })
    }
}

export async function verifyDistributionPackage(
    path: string,
    source: string,
    identity: DistributionRelease,
): Promise<void> {
    const release = parseDistributionRelease(identity)
    const payload = await distributionPayload(source, release)
    if (path.endsWith('.deb')) {
        assertPackageFiles(
            packageTar(await distributionBytes(['dpkg-deb', '--fsys-tarfile', path])),
            payload,
        )
        assertPackageFiles(
            packageTar(await distributionBytes(['dpkg-deb', '--ctrl-tarfile', path])),
            debControl(release),
        )
    } else if (path.endsWith('.rpm')) {
        assertPackageFiles(packageCpio(await distributionBytes(['rpm2cpio', path])), payload)
        const version = distributionPackageVersion(release.version, release.packageRevision)
        const query = (format: string) => distributionCommand(['rpm', '-qp', '--qf', format, path])
        const headerFiles = (
            await query(
                '[%{FILENAMES}|%{FILEMODES:octal}|%{FILEUSERNAME}|%{FILEGROUPNAME}|%{FILEFLAGS}|%{FILECAPS}|%{FILELINKTOS}\n]',
            )
        )
            .trim()
            .split('\n')
        if (headerFiles.length !== payload.length) throw new Error('Unexpected RPM file header')
        for (const file of payload) {
            const parts = headerFiles
                .find((line) => line.startsWith('/' + file.path + '|'))
                ?.split('|')
            if (
                !parts ||
                Number.parseInt(parts[1]!, 8) !== (0o100000 | file.mode) ||
                parts[2] !== 'root' ||
                parts[3] !== 'root' ||
                parts[4] !== '0' ||
                parts[5] !== '(none)' ||
                parts[6]
            )
                throw new Error('Unsafe RPM file metadata')
        }
        const dependencies = (
            await query('[%{REQUIRENAME}|%{REQUIREFLAGS:depflags}|%{REQUIREVERSION}\n]')
        )
            .trim()
            .split('\n')
        const expectedDependencies = [
            '/bin/bash||',
            'bash||',
            'coreutils||',
            'util-linux||',
            'podman|>=|5.4',
            'systemd|>=|252',
            'rpmlib(CompressedFileNames)|<=|3.0.4-1',
            'rpmlib(FileDigests)|<=|4.6.0-1',
            'rpmlib(PayloadFilesHavePrefix)|<=|4.0-1',
            'rpmlib(PayloadIsXz)|<=|5.2-1',
        ]
        if (
            dependencies.some((line) => !expectedDependencies.includes(line)) ||
            expectedDependencies.some((line) => !dependencies.includes(line))
        )
            throw new Error('Unexpected RPM dependencies')
        if (
            (await query('%{NAME}\n%{VERSION}\n%{RELEASE}\n%{ARCH}\n')) !==
            `rentnerproxy\n${version.rpmVersion}\n${version.rpmRelease}\n${packageArchitecture(release.platform, 'rpm')}\n`
        )
            throw new Error('RPM identity mismatch')
        const hooks = [
            packagePreinstall,
            packagePostinstall,
            'if [[ $1 == 0 ]]; then\n' + packageStop.split('\n').slice(1).join('\n') + 'fi',
            'if [[ $1 == 0 ]]; then\n' + packageRemoved.split('\n').slice(1).join('\n') + 'fi',
        ]
        for (const [index, tag] of ['PREIN', 'POSTIN', 'PREUN', 'POSTUN'].entries()) {
            const expected =
                index < 2 ? hooks[index]!.split('\n').slice(1).join('\n') : hooks[index]!
            if (
                (await query(`%{${tag}}`)).trim() !== expected.trim() ||
                (await query(`[%{${tag}PROG}]`)) !== '/bin/bash'
            )
                throw new Error('Unexpected RPM scriptlet')
        }
        for (const tag of [
            'PRETRANS',
            'POSTTRANS',
            'VERIFYSCRIPT',
            'TRIGGERSCRIPTS',
            'FILETRIGGERSCRIPTS',
            'TRANSFILETRIGGERSCRIPTS',
        ]) {
            const value = (await query(`[%{${tag}}]`)).trim()
            if (value && value !== '(none)') throw new Error('Unexpected RPM execution hook')
        }
        if ((await query('[%{FILECAPS}]')).replaceAll('(none)', '').trim())
            throw new Error('Unexpected package capabilities')
    } else throw new Error('Unsupported distribution package')
}

export async function buildDistributionPackages(
    source: string,
    output: string,
    identity: DistributionRelease,
) {
    const release = parseDistributionRelease(identity)
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-package-'))
    try {
        const payload = await distributionPayload(source, release)
        const root = join(directory, 'payload')
        await materialize(root, payload)
        await materialize(join(root, 'DEBIAN'), debControl(release))
        await mkdir(output, { recursive: true })
        const stem = `rentnerproxy-${release.version.slice(1)}-${release.packageRevision}-${release.platform.split('/')[1]}`
        const deb = join(output, stem + '.deb')
        await distributionCommand(['dpkg-deb', '--root-owner-group', '--build', root, deb], {
            env: { ...process.env, SOURCE_DATE_EPOCH: '0' },
        })
        await rm(join(root, 'DEBIAN'), { recursive: true })
        const top = join(directory, 'rpm')
        for (const path of ['SPECS', 'SOURCES', 'BUILD', 'BUILDROOT', 'RPMS', 'SRPMS'])
            await mkdir(join(top, path), { recursive: true })
        await materialize(join(top, 'SOURCES/payload'), payload)
        const spec = join(top, 'SPECS/rentnerproxy.spec')
        await writeFile(spec, rpmSpec(release, payload))
        await distributionCommand([
            'rpmbuild',
            '--target',
            packageArchitecture(release.platform, 'rpm') + '-linux',
            '--define',
            '_topdir ' + top,
            '--define',
            '_build_id_links none',
            '--define',
            '_binary_payload w9.xzdio',
            '-bb',
            spec,
        ])
        const architecture = packageArchitecture(release.platform, 'rpm')
        const candidates = await readdir(join(top, 'RPMS', architecture))
        if (candidates.length !== 1) throw new Error('Unexpected RPM output')
        const rpm = join(output, stem + '.rpm')
        await renamePackage(join(top, 'RPMS', architecture, candidates[0]!), rpm)
        for (const path of [deb, rpm]) await verifyDistributionPackage(path, source, release)
        await writeFile(join(root, 'install.sh'), quadletInstaller(payload), { mode: 0o755 })
        await writeFile(join(root, 'uninstall.sh'), quadletUninstaller(payload), { mode: 0o755 })
        const quadlet = join(output, stem + '-quadlet.tar.gz')
        await distributionCommand([
            'tar',
            '--create',
            '--gzip',
            '--file=' + quadlet,
            '--sort=name',
            '--mtime=@0',
            '--owner=0',
            '--group=0',
            '--numeric-owner',
            '--directory=' + root,
            '.',
        ])
        await verifyQuadletArchive(quadlet, source, release)
        const files = await Promise.all(
            [deb, rpm, quadlet].map(async (path) => {
                const bytes = await readFile(path)
                return {
                    file: path.split(/[\\/]/u).at(-1)!,
                    bytes: bytes.length,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                }
            }),
        )
        const manifest = { release, files }
        await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest) + '\n', {
            flag: 'wx',
        })
        return manifest
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

async function renamePackage(source: string, destination: string) {
    await writeFile(destination, await readFile(source), { flag: 'wx', mode: 0o644 })
}

if (import.meta.main) {
    const [source, output, identity] = process.argv.slice(2)
    if (!source || !output || !identity)
        throw new Error('Expected source, output, immutable release JSON')
    await buildDistributionPackages(
        resolve(source),
        resolve(output),
        parseDistributionRelease(JSON.parse(await readFile(identity, 'utf8'))),
    )
}
