import { expect, test } from 'bun:test'
import {
    artifactFilename,
    assertSigningKey,
    consumerInstructions,
    repositoryUrl,
    signingFingerprint,
} from '../../../../../.github/scripts/distribution/repository.ts'
import {
    assertPackageFiles,
    packageCpio,
    packageTar,
} from '../../../../../.github/scripts/distribution/archive.ts'

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
