import { expect, test } from 'bun:test'
import {
    packageTar,
    packageCpio,
    assertPackageFiles,
} from '../../../../../.github/scripts/distribution/archive.ts'

function tar(
    options: {
        name?: string
        mode?: number
        uid?: number
        gid?: number
        kind?: string
        link?: string
        size?: number
        invalidNumber?: boolean
    } = {},
) {
    const header = Buffer.alloc(512),
        content = Buffer.from('approved\n')
    header.write(options.name ?? 'usr/bin/rentnerproxy')
    const octal = (value: number, start: number, width: number) =>
        header.write(value.toString(8).padStart(width - 1, '0') + '\0', start)
    octal(options.mode ?? 0o755, 100, 8)
    octal(options.uid ?? 0, 108, 8)
    octal(options.gid ?? 0, 116, 8)
    octal(options.size ?? content.length, 124, 12)
    octal(0, 136, 12)
    if (options.invalidNumber) header.write('not-octal', 124)
    header[156] = (options.kind ?? '0').charCodeAt(0)
    if (options.link) header.write(options.link, 157)
    header.fill(32, 148, 156)
    const checksum = header
        .reduce((sum, value) => sum + value, 0)
        .toString(8)
        .padStart(6, '0')
    header.write(checksum + '\0 ', 148)
    return Buffer.concat([header, content, Buffer.alloc(512 - content.length), Buffer.alloc(1024)])
}

function cpioEntry(
    name: string,
    content: string,
    options: { uid?: number; mode?: number; links?: number } = {},
) {
    const body = Buffer.from(content),
        nameBytes = Buffer.from(name + '\0')
    const fields = [
        1,
        options.mode ?? 0o100755,
        options.uid ?? 0,
        0,
        options.links ?? 1,
        0,
        body.length,
        0,
        0,
        0,
        0,
        nameBytes.length,
        0,
    ]
    const header = Buffer.from(
        '070701' + fields.map((value) => value.toString(16).padStart(8, '0')).join(''),
    )
    return Buffer.concat([
        header,
        nameBytes,
        Buffer.alloc((4 - ((header.length + nameBytes.length) % 4)) % 4),
        body,
        Buffer.alloc((4 - (body.length % 4)) % 4),
    ])
}
function cpio(options: Parameters<typeof cpioEntry>[2] = {}, name = './usr/bin/rentnerproxy') {
    return Buffer.concat([cpioEntry(name, 'approved\n', options), cpioEntry('TRAILER!!!', '')])
}

test('tar package inspection rejects traversal, links, ownership changes and malformed headers before extraction', () => {
    const expected = [{ path: 'usr/bin/rentnerproxy', mode: 0o755, content: 'approved\n' }] as const
    expect(() => assertPackageFiles(packageTar(tar()), expected)).not.toThrow()
    for (const options of [
        { name: '../outside' },
        { name: '/absolute' },
        { name: 'usr//bin/evil' },
        { name: 'usr/./evil' },
        { uid: 1000 },
        { gid: 1000 },
        { link: '../outside' },
        { kind: '2' },
        { kind: 'x' },
        { kind: '5' },
        { size: 5 * 1024 * 1024 },
        { invalidNumber: true },
    ])
        expect(() => packageTar(tar(options))).toThrow()
    expect(() => assertPackageFiles(packageTar(tar({ mode: 0o4755 })), expected)).toThrow(
        'mismatch',
    )
    const badChecksum = tar()
    badChecksum[0] = 120
    expect(() => packageTar(badChecksum)).toThrow()
    expect(() => packageTar(tar().subarray(0, 100))).toThrow('Truncated')
    expect(() => packageTar(Buffer.concat([tar(), Buffer.from('unexpected')]))).toThrow('Trailing')
    expect(() =>
        assertPackageFiles(
            [{ path: 'etc/sudoers.d', mode: 0o777, directory: true, content: Buffer.alloc(0) }],
            [],
        ),
    ).toThrow('Unexpected')
})

test('RPM cpio inspection rejects symlinks, hard links, traversal, truncation and hidden trailing data', () => {
    const expected = [{ path: 'usr/bin/rentnerproxy', mode: 0o755, content: 'approved\n' }] as const
    expect(() => assertPackageFiles(packageCpio(cpio()), expected)).not.toThrow()
    for (const options of [{ uid: 1000 }, { links: 2 }, { mode: 0o120777 }, { mode: 0o060600 }])
        expect(() => packageCpio(cpio(options))).toThrow()
    for (const name of ['../outside', '/absolute', 'usr//evil', 'usr/./evil'])
        expect(() => packageCpio(cpio({}, name))).toThrow()
    expect(() => packageCpio(cpio().subarray(0, 115))).toThrow('Truncated')
    expect(() => packageCpio(Buffer.concat([cpio(), Buffer.from('unexpected')]))).toThrow(
        'Trailing',
    )
    const invalidField = cpio()
    invalidField[23] = 122
    expect(() => packageCpio(invalidField)).toThrow('field')
    const invalidMagic = cpio()
    invalidMagic[0] = 48
    invalidMagic[5] = 50
    expect(() => packageCpio(invalidMagic)).toThrow('Unsupported')
    const withoutTrailer = cpioEntry('./usr/bin/rentnerproxy', 'approved\n')
    expect(() => packageCpio(withoutTrailer)).toThrow('terminator')
})
