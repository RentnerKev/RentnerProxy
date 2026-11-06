import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import {
    prepareCompactReleaseAssets,
    readVerificationArchive,
    verificationArchiveName,
    verifyCompactReleaseAssets,
} from '../../../../../.github/scripts/distribution/compact-assets.ts'
import { distributionAssetsFixture, compactTag } from './fixtures/compact-assets.ts'
import { verifyConsumerPackage } from '../../../../../.github/scripts/distribution/consumer.ts'
import { parseDistributionRelease } from '../../../../../.github/scripts/distribution/release.ts'

test('compact presentation preserves all original signed bytes and deterministic proof bindings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rp-compact-assets-'))
    try {
        const source = join(directory, 'source'),
            first = join(directory, 'first'),
            second = join(directory, 'second')
        await mkdir(source)
        const original = await distributionAssetsFixture(source)
        const names = await prepareCompactReleaseAssets(source, first, compactTag)
        expect(names).toHaveLength(8)
        expect(names).toContain('INSTALL.txt')
        expect(names).toContain(verificationArchiveName(compactTag))
        await prepareCompactReleaseAssets(source, second, compactTag)
        await prepareCompactReleaseAssets(source, first, compactTag)
        const verified = await verifyCompactReleaseAssets(first, compactTag)
        expect(verified.installers).toHaveLength(6)
        const archived = readVerificationArchive(
            await readFile(join(first, verificationArchiveName(compactTag))),
        )
        expect(archived.size).toBe(original.size - 6)
        await Promise.all(
            [...original].map(async ([name, bytes]) => {
                expect(
                    verified.installers.includes(name)
                        ? await readFile(join(first, name))
                        : archived.get(name),
                ).toEqual(bytes)
                expect(new Uint8Array(await readFile(join(source, name)))).toEqual(
                    new Uint8Array(bytes),
                )
            }),
        )
        await Promise.all(
            names.map(async (name) => {
                expect(await readFile(join(first, name))).toEqual(
                    await readFile(join(second, name)),
                )
            }),
        )
        const instructions = await readFile(join(first, 'INSTALL.txt'), 'utf8')
        expect(instructions).toContain('not separately OpenPGP-signed')
        expect(instructions).toContain('all three matching DEB/RPM/Quadlet')
        expect(instructions).toContain(`/releases/${compactTag}/1/ARCH/`)
        const consumer = join(directory, 'consumer')
        await mkdir(consumer)
        const catalog = ['amd64', 'arm64'].map((architecture) =>
            JSON.parse(
                original.get(`rentnerproxy-${compactTag}-${architecture}-release.json`)!.toString(),
            ),
        )
        await writeFile(join(consumer, 'catalog.json'), JSON.stringify(catalog))
        const deb = verified.installers.find((name) => name.endsWith('-amd64.deb'))!
        await writeFile(join(consumer, 'download.deb'), await readFile(join(first, deb)))
        await verifyConsumerPackage(
            consumer,
            'debian',
            'linux/amd64',
            parseDistributionRelease(catalog[0].release),
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test.each([
    'installer',
    'metadata',
    'extra',
    'missing',
    'nested',
    'hardlink',
    'collision',
    'guide',
])('rejects substituted or unsafe compact input/output: %s', async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'rp-compact-rejection-'))
    try {
        const source = join(directory, 'source'),
            output = join(directory, 'output')
        await mkdir(source)
        const original = await distributionAssetsFixture(source)
        if (mode === 'collision') {
            await prepareCompactReleaseAssets(source, output, compactTag)
            await writeFile(join(output, 'INSTALL.txt'), 'conflicting guide')
        } else if (mode === 'missing') await rm(join(source, 'distribution.intoto.json.asc'))
        else if (mode === 'nested') {
            await mkdir(join(source, 'nested'))
            await writeFile(join(source, 'nested/data'), 'nested')
        } else if (mode === 'hardlink')
            await link(join(source, 'MAINTAINER.txt'), join(directory, 'linked-maintainer'))
        else if (mode === 'extra')
            await writeFile(join(source, 'rentnerproxy-update.json'), 'must stay outside archive')
        else if (mode === 'guide')
            await writeFile(
                join(source, `rentnerproxy-${compactTag}-arm64-INSTALL.txt`),
                'different',
            )
        else
            await writeFile(
                join(
                    source,
                    mode === 'installer'
                        ? [...original.keys()].find((name) => name.endsWith('.deb'))!
                        : 'MAINTAINER.txt',
                ),
                'substituted',
            )
        await expect(prepareCompactReleaseAssets(source, output, compactTag)).rejects.toThrow()
        await expect(prepareCompactReleaseAssets(source, source, compactTag)).rejects.toThrow(
            'separate',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('archive readers reject duplicate, traversal and link entries; consumers detect changed installer bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rp-compact-consumer-'))
    try {
        const source = join(directory, 'source'),
            output = join(directory, 'output')
        await mkdir(source)
        await distributionAssetsFixture(source)
        await prepareCompactReleaseAssets(source, output, compactTag)
        const bytes = await readFile(join(output, verificationArchiveName(compactTag)))
        const tar = gunzipSync(bytes)
        const size = Number.parseInt(
            tar.subarray(124, 136).toString().replace(/\0.*$/su, '').trim(),
            8,
        )
        const first = tar.subarray(0, 512 + Math.ceil(size / 512) * 512)
        expect(() =>
            readVerificationArchive(
                gzipSync(Buffer.concat([tar.subarray(0, -1024), first, Buffer.alloc(1024)])),
            ),
        ).toThrow('entry')
        for (const mode of ['traversal', 'link']) {
            const changed = Buffer.from(tar)
            if (mode === 'traversal') {
                changed.fill(0, 0, 100)
                changed.write('../escape')
            } else changed.write('2', 156)
            changed.fill(32, 148, 156)
            const checksum = [...changed.subarray(0, 512)].reduce((sum, byte) => sum + byte, 0)
            changed.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
            expect(() => readVerificationArchive(gzipSync(changed))).toThrow()
        }
        const installer = (await readdir(output)).find((name) => name.endsWith('.deb'))!
        await writeFile(join(output, installer), 'changed download')
        await expect(verifyCompactReleaseAssets(output, compactTag)).rejects.toThrow('checksum')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
