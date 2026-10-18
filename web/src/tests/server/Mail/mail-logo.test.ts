import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { decode } from 'fast-png'
import { getMailLogoPng } from '@/server/Mail/mail-logo.ts'

describe('mail branding PNG', () => {
    test('provides a compact transparent PNG', async () => {
        const content = await getMailLogoPng('#30ee61')
        expect(Buffer.isBuffer(content)).toBe(true)
        expect(content.length).toBeLessThan(400_000)
        expect(content.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const image = decode(content)
        expect([image.width, image.height, image.depth, image.channels]).toEqual([512, 192, 8, 4])
    })

    test('keeps source colors, alpha edges and unmasked portrait while recoloring only accents', async () => {
        const [sourceBytes, maskBytes, originalPng, redPng] = await Promise.all([
            readFile(new URL('../../../../public/rentnerproxy-logo-long.png', import.meta.url)),
            readFile(
                new URL(
                    '../../../../public/rentnerproxy-logo-long-accent-mask.png',
                    import.meta.url,
                ),
            ),
            getMailLogoPng('#30ee61'),
            getMailLogoPng('#ee3030'),
        ])
        const source = decode(sourceBytes)
        const mask = decode(maskBytes)
        const original = decode(originalPng)
        const red = decode(redPng)
        let untouchedPixels = 0
        let changedPixels = 0
        let partialAlphaPixels = 0
        let transparentPixels = 0
        for (let y = 0; y < original.height; y += 1) {
            for (let x = 0; x < original.width; x += 1) {
                const output = (y * original.width + x) * 4
                const totals = [0, 0, 0]
                let alpha = 0
                let masked = false
                for (let dy = 0; dy < 4; dy += 1) {
                    for (let dx = 0; dx < 4; dx += 1) {
                        const input = ((y * 4 + dy) * source.width + x * 4 + dx) * 4
                        const weight = source.data[input + 3]!
                        alpha += weight
                        for (let channel = 0; channel < 3; channel += 1) {
                            totals[channel]! += source.data[input + channel]! * weight
                        }
                        masked ||= mask.data[input + 3]! > 0 && weight > 0
                    }
                }
                if (original.data[output + 3] !== Math.round(alpha / 16)) {
                    throw new Error(`Source transparency changed at ${x},${y}`)
                }
                if (red.data[output + 3] !== original.data[output + 3]) {
                    throw new Error(`Recoloring changed transparency at ${x},${y}`)
                }
                for (let channel = 0; channel < 3; channel += 1) {
                    const expected = alpha === 0 ? 0 : Math.round(totals[channel]! / alpha)
                    if (original.data[output + channel] !== expected) {
                        throw new Error(`Default branding color changed at ${x},${y}`)
                    }
                    if (!masked && red.data[output + channel] !== expected) {
                        throw new Error(`Unmasked branding color changed at ${x},${y}`)
                    }
                }
                const alphaByte = original.data[output + 3]!
                if (alphaByte === 0) transparentPixels += 1
                else if (alphaByte < 255) partialAlphaPixels += 1
                if (!masked && alphaByte > 0) untouchedPixels += 1
                if (masked) {
                    const originalLuminance =
                        0.3 * original.data[output]! +
                        0.59 * original.data[output + 1]! +
                        0.11 * original.data[output + 2]!
                    const redLuminance =
                        0.3 * red.data[output]! +
                        0.59 * red.data[output + 1]! +
                        0.11 * red.data[output + 2]!
                    if (Math.abs(originalLuminance - redLuminance) > 1.01) {
                        throw new Error(`Color blending changed luminance at ${x},${y}`)
                    }
                    if (red.data[output]! > original.data[output]! + 20) changedPixels += 1
                }
            }
        }
        expect(untouchedPixels).toBeGreaterThan(1000)
        expect(changedPixels).toBeGreaterThan(1000)
        expect(partialAlphaPixels).toBeGreaterThan(100)
        expect(transparentPixels).toBeGreaterThan(1000)
    })

    test('normalizes unsafe colors and isolates cached bytes from caller mutation', async () => {
        const [original, invalid, uppercase, lowercase] = await Promise.all([
            getMailLogoPng('#30ee61'),
            getMailLogoPng('url(https://example.test/image.png)'),
            getMailLogoPng('#EE3030'),
            getMailLogoPng('#ee3030'),
        ])
        expect(invalid).toEqual(original)
        expect(uppercase).toEqual(lowercase)
        expect(uppercase).not.toBe(lowercase)
        uppercase.fill(0)
        expect(await getMailLogoPng('#ee3030')).toEqual(lowercase)
    })
})
