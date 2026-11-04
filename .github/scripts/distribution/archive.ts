import type { DistributionPayloadFile } from './Types/distribution.types.ts'

export interface PackageEntry {
    readonly path: string
    readonly mode: number
    readonly content: Buffer
    readonly directory?: true
}

function pathName(value: string): string {
    const path = value.replace(/^\.\//u, '').replace(/\/$/u, '')
    if (path === '' || path === '.') return ''
    if (
        !/^[A-Za-z0-9_.+/-]+$/u.test(path) ||
        path.split('/').some((part) => !part || part === '.' || part === '..')
    )
        throw new Error('Unsafe package archive path')
    return path
}

export function packageTar(bytes: Uint8Array): PackageEntry[] {
    const data = Buffer.from(bytes)
    const result: PackageEntry[] = []
    for (let offset = 0; offset < data.length;) {
        const header = data.subarray(offset, offset + 512)
        if (header.length !== 512) throw new Error('Truncated package tar')
        if (header.every((byte) => byte === 0)) {
            if (!data.subarray(offset).every((byte) => byte === 0))
                throw new Error('Trailing package tar data')
            return result
        }
        const text = (start: number, end: number) =>
            header.subarray(start, end).toString('utf8').replace(/\0.*$/su, '')
        const octal = (start: number, end: number) => {
            const value = text(start, end).trim()
            if (!/^[0-7]+$/u.test(value)) throw new Error('Invalid tar numeric field')
            return Number.parseInt(value, 8)
        }
        const checksum = [...header].reduce(
            (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
            0,
        )
        if (
            checksum !== octal(148, 156) ||
            octal(108, 116) !== 0 ||
            octal(116, 124) !== 0 ||
            text(157, 257)
        )
            throw new Error('Invalid package tar ownership or links')
        const name = pathName((text(345, 500) ? text(345, 500) + '/' : '') + text(0, 100))
        const size = octal(124, 136)
        const mode = octal(100, 108)
        const kind = text(156, 157)
        if (
            !['', '0', '5'].includes(kind) ||
            size > 4 * 1024 * 1024 ||
            offset + 512 + size > data.length
        )
            throw new Error('Unsupported package tar entry')
        if (kind === '5') {
            if (size || mode & ~0o777) throw new Error('Invalid package directory')
            result.push({ path: name, mode, content: Buffer.alloc(0), directory: true })
        } else {
            if (!name) throw new Error('Invalid package file')
            result.push({
                path: name,
                mode,
                content: data.subarray(offset + 512, offset + 512 + size),
            })
        }
        offset += 512 + Math.ceil(size / 512) * 512
    }
    throw new Error('Missing package tar terminator')
}

export function packageCpio(bytes: Uint8Array): PackageEntry[] {
    const data = Buffer.from(bytes)
    const result: PackageEntry[] = []
    let offset = 0
    while (offset + 110 <= data.length) {
        if (data.subarray(offset, offset + 6).toString('ascii') !== '070701')
            throw new Error('Unsupported package cpio')
        const field = (index: number) => {
            const value = data
                .subarray(offset + 6 + index * 8, offset + 14 + index * 8)
                .toString('ascii')
            if (!/^[a-fA-F0-9]{8}$/u.test(value)) throw new Error('Invalid cpio field')
            return Number.parseInt(value, 16)
        }
        const links = field(4)
        const mode = field(1),
            size = field(6),
            namesize = field(11)
        if (
            field(2) ||
            field(3) ||
            field(9) ||
            field(10) ||
            field(12) ||
            namesize < 1 ||
            namesize > 512 ||
            size > 4 * 1024 * 1024
        )
            throw new Error('Invalid cpio ownership or bounds')
        const nameEnd = offset + 110 + namesize
        if (nameEnd > data.length || data[nameEnd - 1] !== 0) throw new Error('Truncated cpio name')
        const name = data.subarray(offset + 110, nameEnd - 1).toString('utf8')
        offset = Math.ceil(nameEnd / 4) * 4
        if (name === 'TRAILER!!!') {
            if (size || !data.subarray(offset).every((byte) => byte === 0))
                throw new Error('Trailing cpio data')
            return result
        }
        const path = pathName(name)
        if (offset + size > data.length || !path) throw new Error('Invalid cpio file')
        if ((mode & 0o170000) === 0o100000) {
            if (links !== 1) throw new Error('Package hard link is forbidden')
            result.push({
                path,
                mode: mode & 0o7777,
                content: data.subarray(offset, offset + size),
            })
        } else if ((mode & 0o170000) !== 0o040000 || size || mode & 0o7000)
            throw new Error('Unsupported cpio entry')
        else result.push({ path, mode: mode & 0o7777, content: Buffer.alloc(0), directory: true })
        offset = Math.ceil((offset + size) / 4) * 4
    }
    throw new Error('Missing package cpio terminator')
}

export function assertPackageFiles(
    entries: readonly PackageEntry[],
    expected: readonly DistributionPayloadFile[],
): void {
    const files = entries.filter((entry) => !entry.directory)
    const directories = new Set([
        '',
        ...expected.flatMap((file) =>
            file.path
                .split('/')
                .slice(0, -1)
                .map((_, index) =>
                    file.path
                        .split('/')
                        .slice(0, index + 1)
                        .join('/'),
                ),
        ),
    ])
    if (
        files.length !== expected.length ||
        entries.some(
            (entry) => entry.directory && (!directories.has(entry.path) || entry.mode !== 0o755),
        ) ||
        new Set(entries.map((entry) => entry.path)).size !== entries.length
    )
        throw new Error('Unexpected package files')
    for (const file of expected) {
        const entry = files.find((candidate) => candidate.path === file.path)
        if (!entry || entry.mode !== file.mode || !entry.content.equals(Buffer.from(file.content)))
            throw new Error('Package payload mismatch: ' + file.path)
    }
}
