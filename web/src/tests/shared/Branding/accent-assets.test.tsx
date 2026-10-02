import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { renderToString } from 'react-dom/server'

import BrandRasterImage from '@/shared/Branding/BrandRasterImage.tsx'

const publicAsset = (name: string) =>
    readFileSync(new URL(`../../../../public/${name}`, import.meta.url))

function readMask(name: string) {
    const png = publicAsset(name)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(6)

    const imageData: Buffer[] = []
    for (let position = 8; position < png.length;) {
        const length = png.readUInt32BE(position)
        const type = png.toString('ascii', position + 4, position + 8)
        if (type === 'IDAT') imageData.push(png.subarray(position + 8, position + 8 + length))
        position += length + 12
    }
    const pixels = inflateSync(Buffer.concat(imageData))
    expect(pixels.length).toBe(height * (1 + width * 4))
    let transparent = false
    let colored = false
    for (let row = 0; row < height; row++) {
        const rowStart = row * (1 + width * 4)
        expect(pixels[rowStart]).toBe(0)
        for (let column = 0; column < width; column++) {
            const alpha = pixels[rowStart + 1 + column * 4 + 3]!
            transparent ||= alpha === 0
            colored ||= alpha > 0
        }
    }
    expect(transparent).toBeTrue()
    expect(colored).toBeTrue()
    return { width, height }
}

describe('generated accent artwork', () => {
    test.each([
        ['rentnerproxy-logo.png', 'rentnerproxy-logo-accent-mask.png'],
        ['rentnerproxy-logo-long.png', 'rentnerproxy-logo-long-accent-mask.png'],
        ['login-panel-background-v1.png', 'login-panel-background-v1-accent-mask.png'],
    ])('%s has an aligned, nonempty color mask', (source, mask) => {
        const original = publicAsset(source)
        expect(readMask(mask)).toEqual({
            width: original.readUInt32BE(16),
            height: original.readUInt32BE(20),
        })
    })

    test.each([
        ['system-error-v1-960.webp', 'system-error-v1-960-accent-mask.png'],
        ['system-not-found-v1-960.webp', 'system-not-found-v1-960-accent-mask.png'],
    ])('%s has a matching 960px artwork mask', (source, mask) => {
        expect(publicAsset(source).subarray(0, 4).toString()).toBe('RIFF')
        expect(readMask(mask)).toEqual({ width: 960, height: 960 })
    })

    test('logo keeps the original image and layers a custom accent only when selected', () => {
        const html = renderToString(
            <BrandRasterImage asset="logo" alt="RentnerProxy" width={300} height={300} />,
        )
        expect(html).toContain('/rentnerproxy-logo.png')
        expect(html).toContain('/rentnerproxy-logo-accent-mask.png')
        expect(html).toContain('group-data-[accent-custom=true]:opacity-100')
    })
})
