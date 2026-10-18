import { readFile } from 'node:fs/promises'
import { decode, encode } from 'fast-png'
import type { DecodedPng } from 'fast-png'
import logoAsset from '../../../public/rentnerproxy-logo-long.png?inline'
import maskAsset from '../../../public/rentnerproxy-logo-long-accent-mask.png?inline'
import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import {
    MAIL_LOGO_CACHE_SIZE,
    MAIL_LOGO_CID,
    MAIL_LOGO_HEIGHT,
    MAIL_LOGO_WIDTH,
} from '@/config/mail.config.ts'
import { deriveAccentPalette } from '@/lib/Theme/accentPalette.ts'
import type { MailLogoAttachment } from './Types/mail-logo.types.ts'

const logos = new Map<string, Promise<Buffer>>()
let sources: Promise<readonly [DecodedPng, DecodedPng]> | undefined

async function readBrandAsset(kind: 'logo' | 'mask'): Promise<DecodedPng> {
    // Vite embeds these literal imports in SSR; Bun resolves them to local absolute paths.
    // Neither representation nor the path can be selected by mail settings or recipients.
    const asset = kind === 'logo' ? logoAsset : maskAsset
    const prefix = 'data:image/png;base64,'
    const bytes = asset.startsWith(prefix)
        ? Buffer.from(asset.slice(prefix.length), 'base64')
        : await readFile(asset)
    const image = decode(bytes, { checkCrc: true })
    if (image.depth !== 8 || image.channels !== 4) {
        throw new Error('Mail branding must use 8-bit RGBA PNG assets')
    }
    return image
}

function loadSources(): Promise<readonly [DecodedPng, DecodedPng]> {
    sources ??= Promise.all([readBrandAsset('logo'), readBrandAsset('mask')]).catch(
        (error: unknown) => {
            sources = undefined
            throw error
        },
    )
    return sources
}

function colorBlend(red: number, green: number, blue: number, luminance: number) {
    // W3C compositing-1: color = ClipColor(SetLum(source, Lum(backdrop))).
    // These operations use unpremultiplied sRGB channels, as CSS mix-blend-color does.
    const difference = luminance - (0.3 * red + 0.59 * green + 0.11 * blue)
    let r = red + difference
    let g = green + difference
    let b = blue + difference
    const minimum = Math.min(r, g, b)
    const maximum = Math.max(r, g, b)
    if (minimum < 0) {
        const scale = luminance / (luminance - minimum)
        r = luminance + (r - luminance) * scale
        g = luminance + (g - luminance) * scale
        b = luminance + (b - luminance) * scale
    }
    if (maximum > 255) {
        const scale = (255 - luminance) / (maximum - luminance)
        r = luminance + (r - luminance) * scale
        g = luminance + (g - luminance) * scale
        b = luminance + (b - luminance) * scale
    }
    return [r, g, b] as const
}

async function renderLogo(accent: string): Promise<Buffer> {
    const [logo, mask] = await loadSources()
    const scale = logo.width / MAIL_LOGO_WIDTH
    if (
        !Number.isInteger(scale) ||
        scale < 1 ||
        logo.height !== MAIL_LOGO_HEIGHT * scale ||
        mask.width !== logo.width ||
        mask.height !== logo.height
    ) {
        throw new Error('Mail branding dimensions do not match the output aspect ratio')
    }

    const red = Number.parseInt(accent.slice(1, 3), 16)
    const green = Number.parseInt(accent.slice(3, 5), 16)
    const blue = Number.parseInt(accent.slice(5, 7), 16)
    const customAccent = accent !== DEFAULT_ACCENT_COLOR
    const data = new Uint8Array(MAIL_LOGO_WIDTH * MAIL_LOGO_HEIGHT * 4)
    for (let y = 0; y < MAIL_LOGO_HEIGHT; y += 1) {
        for (let x = 0; x < MAIL_LOGO_WIDTH; x += 1) {
            let alphaSum = 0
            let redSum = 0
            let greenSum = 0
            let blueSum = 0
            for (let dy = 0; dy < scale; dy += 1) {
                for (let dx = 0; dx < scale; dx += 1) {
                    const offset = ((y * scale + dy) * logo.width + x * scale + dx) * 4
                    const alpha = logo.data[offset + 3]!
                    if (alpha === 0) continue
                    let r = logo.data[offset]!
                    let g = logo.data[offset + 1]!
                    let b = logo.data[offset + 2]!
                    const coverage = customAccent ? mask.data[offset + 3]! / 255 : 0
                    if (coverage > 0) {
                        const blended = colorBlend(red, green, blue, 0.3 * r + 0.59 * g + 0.11 * b)
                        r += (blended[0] - r) * coverage
                        g += (blended[1] - g) * coverage
                        b += (blended[2] - b) * coverage
                    }
                    alphaSum += alpha
                    redSum += r * alpha
                    greenSum += g * alpha
                    blueSum += b * alpha
                }
            }
            const target = (y * MAIL_LOGO_WIDTH + x) * 4
            if (alphaSum === 0) continue
            // Area downsampling in premultiplied alpha prevents dark/colored edge halos.
            data[target] = Math.round(redSum / alphaSum)
            data[target + 1] = Math.round(greenSum / alphaSum)
            data[target + 2] = Math.round(blueSum / alphaSum)
            data[target + 3] = Math.round(alphaSum / (scale * scale))
        }
    }
    return Buffer.from(
        encode({ width: MAIL_LOGO_WIDTH, height: MAIL_LOGO_HEIGHT, channels: 4, depth: 8, data }),
    )
}

export async function createMailLogoAttachment(accentColor: string): Promise<MailLogoAttachment> {
    const accent = deriveAccentPalette(accentColor).accent
    let content = logos.get(accent)
    if (content) {
        logos.delete(accent)
        logos.set(accent, content)
    } else {
        content = renderLogo(accent)
        logos.set(accent, content)
        const pending = content
        void pending.catch(() => {
            if (logos.get(accent) === pending) logos.delete(accent)
        })
        if (logos.size > MAIL_LOGO_CACHE_SIZE) {
            const oldest = logos.keys().next().value
            if (oldest !== undefined) logos.delete(oldest)
        }
    }
    return {
        filename: 'rentnerproxy-logo.png',
        cid: MAIL_LOGO_CID,
        content: Buffer.from(await content),
        contentType: 'image/png',
        contentDisposition: 'inline',
    }
}
