// oxlint-disable no-await-in-loop -- Each archive attempt reuses the same isolated input and output paths.
import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

function tarEntry(name: string, type = '0', body = 'locked dependencies', link = '') {
    const bytes = Buffer.from(body)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    header.write('0000600\0', 100, 8)
    header.write('0000000\0', 108, 8)
    header.write('0000000\0', 116, 8)
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12)
    header.write('00000000000\0', 136, 12)
    header.fill(32, 148, 156)
    header.write(type, 156, 1)
    header.write(link, 157, 100)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    const checksum = header.reduce((sum, value) => sum + value, 0)
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8)
    return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}

const script = resolve(
    import.meta.dir,
    '../../../../../.github/scripts/security/extract-image-input.sh',
)

test.skipIf(process.platform === 'win32')(
    'image lock extraction accepts regular data and rejects links, duplicates and other entries',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-image-input-'))
        try {
            const archive = join(directory, 'input.tar')
            const output = join(directory, 'Cargo.lock')
            await writeFile(archive, Buffer.concat([tarEntry('Cargo.lock'), Buffer.alloc(1024)]))
            const extract = () => Bun.spawnSync(['bash', script, archive, output, 'Cargo.lock'])
            expect(extract().exitCode).toBe(0)
            expect(await readFile(output, 'utf8')).toBe('locked dependencies')
            expect((await stat(output)).mode & 0o777).toBe(0o600)
            await rm(output)

            for (const entries of [
                [tarEntry('Cargo.lock', '2', '', '/proc/self/environ')],
                [tarEntry('Cargo.lock', '1', '', '/proc/self/environ')],
                [tarEntry('Cargo.lock', '5', '')],
                [tarEntry('../Cargo.lock')],
                [tarEntry('unexpected')],
                [tarEntry('Cargo.lock'), tarEntry('Cargo.lock')],
                [tarEntry('Cargo.lock'), tarEntry('package.json')],
            ]) {
                await writeFile(archive, Buffer.concat([...entries, Buffer.alloc(1024)]))
                expect(extract().exitCode).not.toBe(0)
                expect(await Bun.file(output).exists()).toBe(false)
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)
