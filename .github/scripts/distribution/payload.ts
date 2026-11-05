import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDistributionRelease } from './release.ts'
import type { DistributionPayloadFile, DistributionRelease } from './Types/distribution.types.ts'

async function sourceText(source: string, path: string): Promise<string> {
    const file = join(source, path)
    const info = await lstat(file)
    if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024)
        throw new Error('Invalid distribution source asset')
    const text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n')
    if (text.includes('\0')) throw new Error('Invalid distribution text asset')
    return text
}

export async function distributionPayload(
    source: string,
    identity: DistributionRelease,
): Promise<readonly DistributionPayloadFile[]> {
    const release = parseDistributionRelease(identity)
    for (const directory of [source, join(source, 'packaging'), join(source, 'packaging/linux')])
        if (!(await lstat(directory)).isDirectory())
            throw new Error('Invalid distribution source directory')
    const [unit, volume, cli, configuration, license] = await Promise.all([
        sourceText(source, 'packaging/linux/rentnerproxy.container.in'),
        sourceText(source, 'packaging/linux/rentnerproxy.volume'),
        sourceText(source, 'packaging/linux/rentnerproxy'),
        sourceText(source, 'packaging/linux/appliance.env.example'),
        sourceText(source, 'LICENSE'),
    ])
    const image = 'ghcr.io/rentnerkev/rentnerproxy@' + release.digest
    if (unit.split('@@IMAGE@@').length !== 2 || unit.split('@@PLATFORM@@').length !== 2)
        throw new Error('Invalid versioned Quadlet template')
    const container = unit.replace('@@IMAGE@@', image).replace('@@PLATFORM@@', release.platform)
    if (container.includes('@@')) throw new Error('Unresolved Quadlet template field')
    return [
        { path: 'usr/bin/rentnerproxy', mode: 0o755, content: cli },
        {
            path: 'usr/share/containers/systemd/rentnerproxy.container',
            mode: 0o644,
            content: container,
        },
        { path: 'usr/share/containers/systemd/rentnerproxy.volume', mode: 0o644, content: volume },
        {
            path: 'usr/share/rentnerproxy/appliance.env.example',
            mode: 0o644,
            content: configuration,
        },
        {
            path: 'usr/share/rentnerproxy/release.json',
            mode: 0o644,
            content: JSON.stringify(release) + '\n',
        },
        { path: 'usr/share/rentnerproxy/image', mode: 0o644, content: image + '\n' },
        { path: 'usr/share/rentnerproxy/platform', mode: 0o644, content: release.platform + '\n' },
        { path: 'usr/share/rentnerproxy/version', mode: 0o644, content: release.version + '\n' },
        { path: 'usr/share/licenses/rentnerproxy/LICENSE', mode: 0o644, content: license },
    ]
}

export const packagePreinstall = `#!/bin/bash
set -eu
umask 077
if [[ -f /usr/share/rentnerproxy/image && ! -L /usr/share/rentnerproxy/image ]]; then
    if [[ -e /var/lib/rentnerproxy-distribution || -L /var/lib/rentnerproxy-distribution ]]; then
        [[ -d /var/lib/rentnerproxy-distribution && ! -L /var/lib/rentnerproxy-distribution && $(stat -c %u /var/lib/rentnerproxy-distribution) == 0 ]] || exit 1
    fi
    install -d -m 0700 /var/lib/rentnerproxy-distribution
    install -m 0600 /usr/share/rentnerproxy/image /var/lib/rentnerproxy-distribution/previous.image
    if [[ -f /usr/share/rentnerproxy/version ]]; then
        install -m 0600 /usr/share/rentnerproxy/version /var/lib/rentnerproxy-distribution/previous.version
    fi
fi
`

export const packagePostinstall = `#!/bin/bash
set -eu
umask 077
if [[ -e /etc/rentnerproxy || -L /etc/rentnerproxy ]]; then
    [[ -d /etc/rentnerproxy && ! -L /etc/rentnerproxy && $(stat -c %u /etc/rentnerproxy) == 0 ]] || exit 1
else
    install -d -m 0700 /etc/rentnerproxy
fi
if [[ -d /run/systemd/system ]]; then
    systemctl daemon-reload
    if systemctl is-active --quiet rentnerproxy.service; then
        /usr/bin/rentnerproxy restart
    fi
fi
`

export const packageStop = `#!/bin/bash
set -eu
if [[ -d /run/systemd/system ]]; then /usr/bin/rentnerproxy stop; fi
`

export const packageRemoved = `#!/bin/bash
set -eu
if [[ -d /run/systemd/system ]]; then systemctl daemon-reload; fi
`
