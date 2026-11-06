import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const compactTag = 'v1.0.0-beta.3'
export const compactIdentity = {
    version: compactTag,
    revision: 'a'.repeat(40),
    digest: 'sha256:' + 'b'.repeat(64),
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function distributionAssetsFixture(directory: string): Promise<Map<string, Buffer>> {
    const files = new Map<string, Buffer>()
    for (const architecture of ['amd64', 'arm64']) {
        const stem = `rentnerproxy-${compactTag.slice(1)}-1-${architecture}`
        const installers = ['.deb', '.rpm', '-quadlet.tar.gz'].map((suffix) => stem + suffix)
        for (const name of installers) files.set(name, Buffer.from('original installer ' + name))
        const prefix = `rentnerproxy-${compactTag}-${architecture}`
        files.set(
            prefix + '-SHA256SUMS',
            Buffer.from(
                installers.map((name) => hash(files.get(name)!) + '  ' + name).join('\n') + '\n',
            ),
        )
        files.set(
            prefix + '-release.json',
            Buffer.from(
                JSON.stringify({
                    release: {
                        schemaVersion: 1,
                        ...compactIdentity,
                        platform: 'linux/' + architecture,
                        packageRevision: 1,
                    },
                    directory: `releases/${compactTag}/1/${architecture}`,
                    files: installers.map((name) => ({
                        file: name,
                        sha256: hash(files.get(name)!),
                        bytes: files.get(name)!.length,
                    })),
                }) + '\n',
            ),
        )
        files.set(
            prefix + '-INSTALL.txt',
            Buffer.from('Original signed installation instructions.\n'),
        )
        files.set(prefix + '.spdx.json', Buffer.from('original SBOM ' + architecture))
        for (const suffix of ['-SHA256SUMS.asc', '-release.json.asc'])
            files.set(prefix + suffix, Buffer.from('original signature'))
    }
    for (const target of ['debian', 'fedora'])
        for (const architecture of ['amd64', 'arm64'])
            files.set(`native-${target}-${architecture}.json`, Buffer.from('original native proof'))
    files.set('assessed-image-evidence.json', Buffer.from('original image evidence'))
    files.set('A'.repeat(40) + '.asc', Buffer.from('original public key'))
    files.set('MAINTAINER.txt', Buffer.from('original maintainer instructions'))
    files.set(
        'distribution.intoto.json',
        Buffer.from(
            JSON.stringify({
                _type: 'https://in-toto.io/Statement/v1',
                predicateType: 'https://slsa.dev/provenance/v1',
                subject: [...files].map(([name, bytes]) => ({
                    name,
                    digest: { sha256: hash(bytes) },
                })),
                predicate: { buildDefinition: { externalParameters: compactIdentity } },
            }) + '\n',
        ),
    )
    files.set('distribution.intoto.json.asc', Buffer.from('original provenance signature'))
    await Promise.all([...files].map(([name, bytes]) => writeFile(join(directory, name), bytes)))
    return files
}
