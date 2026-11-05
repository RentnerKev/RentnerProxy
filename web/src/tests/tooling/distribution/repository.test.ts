// oxlint-disable no-await-in-loop -- Remove each malformed directory before replaying the same catalog again.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    artifactFilename,
    assertSigningKey,
    consumerInstructions,
    repositoryUrl,
    signingFingerprint,
    readRepositoryCatalog,
    updatePackageRepository,
} from '../../../../../.github/scripts/distribution/repository.ts'
import {
    assertPackageFiles,
    packageCpio,
    packageTar,
} from '../../../../../.github/scripts/distribution/archive.ts'

test('repository replay rejects orphaned version, revision and architecture directories before rebuilding indexes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-catalog-tree-'))
    const release = {
        schemaVersion: 1,
        version: 'v1.0.0-beta.3',
        revision: 'a'.repeat(40),
        digest: 'sha256:' + 'b'.repeat(64),
        platform: 'linux/amd64',
        packageRevision: 1,
    }
    const directory = 'releases/v1.0.0-beta.3/1/amd64',
        content = 'fixture',
        files = ['deb', 'rpm', 'tar.gz'].map((suffix) => ({
            file: 'rentnerproxy-fixture.' + suffix,
            bytes: content.length,
            sha256: createHash('sha256').update(content).digest('hex'),
        }))
    try {
        await mkdir(join(root, directory), { recursive: true })
        for (const file of files) await writeFile(join(root, directory, file.file), content)
        await writeFile(join(root, 'catalog.json'), JSON.stringify([{ release, directory, files }]))
        expect(await readRepositoryCatalog(root)).toHaveLength(1)
        for (const orphan of [
            'releases/v1.0.0-beta.4/1/amd64',
            'releases/v1.0.0-beta.3/2',
            'releases/v1.0.0-beta.3/1/arm64',
        ]) {
            await mkdir(join(root, orphan), { recursive: true })
            await expect(readRepositoryCatalog(root)).rejects.toThrow(
                'missing from the signed catalog',
            )
            // Remove only the newly created unknown version/revision/architecture.
            const remove = orphan.startsWith('releases/v1.0.0-beta.4/')
                ? 'releases/v1.0.0-beta.4'
                : orphan
            await rm(join(root, remove), { recursive: true, force: true })
        }
        await writeFile(join(root, 'catalog.json'), '[]')
        await expect(readRepositoryCatalog(root)).rejects.toThrow('missing from the signed catalog')
        await rm(join(root, 'catalog.json'))
        await expect(
            updatePackageRepository({
                root,
                source: root,
                artifacts: [],
                home: join(root, 'unused'),
                fingerprint: 'A'.repeat(40),
                baseUrl: 'https://example.invalid',
            }),
        ).rejects.toThrow('missing from the signed catalog')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('pins public repository URLs, file names and scoped key trust', () => {
    expect(repositoryUrl('https://rentnerkev.github.io/RentnerProxy/')).toBe(
        'https://rentnerkev.github.io/RentnerProxy',
    )
    for (const value of [
        'http://example.com',
        'https://user@example.com',
        'https://example.com/?token=secret',
        'https://example.com/#x',
        'https://example.com/a%20b',
    ])
        expect(() => repositoryUrl(value)).toThrow()
    expect(artifactFilename('rentnerproxy-1.0.0-beta.3-amd64.deb')).toEndWith('.deb')
    for (const value of ['../evil', '.hidden', 'x/evil', 'x..rpm', '', null])
        expect(() => artifactFilename(value)).toThrow()
    const fingerprint = 'A'.repeat(40)
    expect(signingFingerprint(fingerprint)).toBe(fingerprint)
    expect(() => signingFingerprint('AAAA')).toThrow()
    const instructions = consumerInstructions('https://example.com/repository', fingerprint)
    expect(instructions).toContain('signed-by=/usr/share/keyrings/rentnerproxy.gpg')
    expect(instructions).toContain('repo_gpgcheck=1')
    expect(instructions).toContain('--resume')
})

test('refuses wrong, revoked, missing and soon-expiring signing keys', () => {
    const fingerprint = 'A'.repeat(40),
        now = Date.now()
    const listing = (validity: string, expires: number, actual = fingerprint) =>
        `pub:${validity}:3072:1:123:${Math.floor(now / 1000)}:${expires}:::::scSC:\nfpr:::::::::${actual}:\n`
    expect(() =>
        assertSigningKey(listing('u', Math.floor(now / 1000) + 90 * 86400), fingerprint, now),
    ).not.toThrow()
    for (const raw of [
        '',
        listing('r', Math.floor(now / 1000) + 90 * 86400),
        listing('u', 0),
        listing('u', Math.floor(now / 1000) + 10),
        listing('u', Math.floor(now / 1000) + 90 * 86400, 'B'.repeat(40)),
    ])
        expect(() => assertSigningKey(raw, fingerprint, now)).toThrow()
})

test('archive validation fails closed on malformed files, duplicates, modes and substitution', () => {
    for (const bytes of [
        Buffer.alloc(0),
        Buffer.alloc(80),
        Buffer.from('070701' + 'z'.repeat(104)),
    ]) {
        expect(() => packageCpio(bytes)).toThrow()
        expect(() => packageTar(bytes)).toThrow()
    }
    expect(packageTar(Buffer.alloc(1024))).toEqual([])
    const file = { path: 'usr/bin/rentnerproxy', mode: 0o755, content: '#!/bin/bash\n' } as const
    const entry = { ...file, content: Buffer.from(file.content) }
    expect(() => assertPackageFiles([entry], [file])).not.toThrow()
    for (const entries of [
        [],
        [entry, entry],
        [{ ...entry, mode: 0o4755 }],
        [{ ...entry, path: '../evil' }],
        [{ ...entry, content: Buffer.from('changed') }],
    ])
        expect(() => assertPackageFiles(entries, [file])).toThrow()
})
