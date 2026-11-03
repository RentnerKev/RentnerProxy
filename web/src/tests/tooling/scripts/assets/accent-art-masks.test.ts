import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, encode } from 'fast-png'
import {
    accentArtAssets,
    createAccentMask,
    generateAccentMask,
} from '../../../../../../scripts/assets/generate-accent-art-masks.ts'

const publicDirectory = fileURLToPath(new URL('../../../../../public/', import.meta.url))

describe('accent artwork generator', () => {
    test.each(accentArtAssets)('preserves every mask pixel for %s', async (asset) => {
        const actual = decode(await generateAccentMask(join(publicDirectory, asset)), {
            checkCrc: true,
        })
        const expected = decode(
            await readFile(
                join(publicDirectory, basename(asset, extname(asset)) + '-accent-mask.png'),
            ),
            { checkCrc: true },
        )
        expect([actual.width, actual.height, actual.depth, actual.channels]).toEqual([
            expected.width,
            expected.height,
            8,
            4,
        ])
        expect(Buffer.from(actual.data).equals(Buffer.from(expected.data))).toBeTrue()
    })

    test('keeps source alpha and excludes transparent, neutral and other hues', () => {
        const data = Uint8Array.of(
            0,
            255,
            0,
            255,
            0,
            255,
            0,
            15,
            0,
            255,
            0,
            16,
            255,
            0,
            0,
            255,
            128,
            128,
            128,
            255,
            0,
            255,
            255,
            129,
            255,
            0,
            255,
            255,
        )
        const original = data.slice()
        const mask = createAccentMask({ width: 7, height: 1, data }, 'fixture.png')
        expect(Array.from(mask.filter((_, index) => index % 4 === 3))).toEqual([
            255, 0, 16, 0, 0, 129, 0,
        ])
        expect(mask.every((value, index) => index % 4 === 3 || value === 255)).toBeTrue()
        expect(data).toEqual(original)
    })

    test('protects all four status LEDs with feathered, half-to-even alpha', () => {
        const width = 770
        const height = 680
        const data = Buffer.alloc(width * height * 4, Buffer.from([0, 255, 0, 253]))
        const mask = createAccentMask({ width, height, data }, 'system-error-v1-960.webp')
        const alpha = (x: number, y: number) => mask[(y * width + x) * 4 + 3]
        for (const y of [406, 539, 606, 673]) {
            expect(alpha(735, y)).toBe(0)
            expect(alpha(757, y)).toBe(0)
            expect(alpha(761, y)).toBe(126)
            expect(alpha(765, y)).toBe(253)
        }
        expect(alpha(0, 0)).toBe(253)
    })

    test('decodes RGB PNGs and rejects unsupported depth, damaged and missing sources', async () => {
        const parent = resolve(tmpdir())
        const directory = await mkdtemp(join(parent, 'rentnerproxy-accent-generator-'))
        if (!resolve(directory).startsWith(parent + sep))
            throw new Error('Invalid fixture directory')
        const source = join(directory, 'fixture.png')
        try {
            await writeFile(
                source,
                encode({ width: 1, height: 1, channels: 3, data: Uint8Array.of(0, 255, 0) }),
            )
            expect(Array.from(decode(await generateAccentMask(source)).data)).toEqual([
                255, 255, 255, 255,
            ])
            await writeFile(
                source,
                encode({
                    width: 1,
                    height: 1,
                    channels: 4,
                    depth: 16,
                    data: Uint16Array.of(0, 65535, 0, 65535),
                }),
            )
            await expect(generateAccentMask(source)).rejects.toThrow(
                'Expected 8-bit RGB/RGBA artwork',
            )
            await writeFile(source, 'damaged artwork')
            await expect(generateAccentMask(source)).rejects.toThrow()
            const webp = join(directory, 'fixture.webp')
            await writeFile(webp, 'damaged WebP artwork')
            await expect(generateAccentMask(webp)).rejects.toThrow()
            await expect(generateAccentMask(join(directory, 'missing.png'))).rejects.toThrow()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
