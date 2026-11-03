import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decode, encode } from 'fast-png'
import type { RgbaArtwork } from './Types/accent-art-masks.types.ts'

export const accentArtAssets = [
    'rentnerproxy-logo.png',
    'rentnerproxy-logo-long.png',
    'login-panel-background-v1.png',
    'system-error-v1-960.webp',
    'system-not-found-v1-960.webp',
] as const

const protectedCircles = [
    [735, 406, 22, 30],
    [735, 539, 22, 30],
    [735, 606, 22, 30],
    [735, 673, 22, 30],
] as const

function smoothstep(edge0: number, edge1: number, value: number): number {
    const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
    return amount * amount * (3 - 2 * amount)
}

function roundToEven(value: number): number {
    // Preserve the original generator's half-to-even alpha quantization.
    const lower = Math.floor(value)
    return value - lower === 0.5 ? lower + (lower % 2) : Math.round(value)
}

function greenCoverage(red: number, green: number, blue: number, alpha: number): number {
    if (alpha < 16) return 0
    const maximum = Math.max(red, green, blue)
    const chroma = maximum - Math.min(red, green, blue)
    if (chroma === 0 || maximum === 0) return 0

    let hue: number
    if (maximum === red) {
        hue = (green - blue) / chroma
        if (hue < 0) hue += 6
    } else if (maximum === green) {
        hue = (blue - red) / chroma + 2
    } else {
        hue = (red - green) / chroma + 4
    }
    const degrees = hue * 60
    const hueWeight = smoothstep(72, 90, degrees) * (1 - smoothstep(188, 202, degrees))
    const saturationWeight = smoothstep(0.2, 0.65, chroma / maximum)
    return roundToEven(alpha * hueWeight * saturationWeight)
}

export function createAccentMask(image: RgbaArtwork, sourceName: string): Uint8Array {
    const { width, height, data } = image
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        data.length !== width * height * 4
    ) {
        throw new Error('Expected a complete RGBA artwork image')
    }
    const mask = new Uint8Array(data.length)
    const protectStatusLeds = sourceName === 'system-error-v1-960.webp'
    for (let offset = 0; offset < data.length; offset += 4) {
        mask.fill(255, offset, offset + 3)
        let coverage = greenCoverage(
            data[offset]!,
            data[offset + 1]!,
            data[offset + 2]!,
            data[offset + 3]!,
        )
        if (coverage && protectStatusLeds) {
            const pixel = offset / 4
            const x = pixel % width
            const y = Math.floor(pixel / width)
            let protection = 1
            for (const [centerX, centerY, radius, featherEnd] of protectedCircles) {
                const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2
                if (distanceSquared < featherEnd ** 2) {
                    protection = Math.min(
                        protection,
                        smoothstep(radius, featherEnd, Math.sqrt(distanceSquared)),
                    )
                }
            }
            coverage = roundToEven(coverage * protection)
        }
        mask[offset + 3] = coverage
    }
    return mask
}

export async function generateAccentMask(source: string): Promise<Uint8Array> {
    const bytes =
        extname(source).toLowerCase() === '.webp'
            ? await new Bun.Image(source, { maxPixels: 960 * 960, autoOrient: false }).png().bytes()
            : await readFile(source)
    const image = decode(bytes, { checkCrc: true })
    if (image.depth !== 8 || (image.channels !== 3 && image.channels !== 4)) {
        throw new Error('Expected 8-bit RGB/RGBA artwork: ' + source)
    }
    const data = new Uint8Array(image.width * image.height * 4)
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
        const input = pixel * image.channels
        const output = pixel * 4
        data[output] = image.data[input]!
        data[output + 1] = image.data[input + 1]!
        data[output + 2] = image.data[input + 2]!
        data[output + 3] = image.channels === 4 ? image.data[input + 3]! : 255
    }
    return encode(
        {
            width: image.width,
            height: image.height,
            channels: 4,
            depth: 8,
            data: createAccentMask(
                { width: image.width, height: image.height, data },
                basename(source),
            ),
        },
        { zlib: { level: 9 } },
    )
}

if (import.meta.main) {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    await Promise.all(
        accentArtAssets.map(async (asset) => {
            const source = join(root, 'web/public', asset)
            const destination = join(
                root,
                'web/public',
                basename(asset, extname(asset)) + '-accent-mask.png',
            )
            const png = await generateAccentMask(source)
            await writeFile(destination, png)
            const { width, height } = decode(png)
            console.log(`${relative(root, destination)} (${width}x${height}, ${png.length} bytes)`)
        }),
    )
}
