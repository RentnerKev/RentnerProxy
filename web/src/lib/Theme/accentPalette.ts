import type { Rgb, AccentPalette } from './Types/accent-palette.types.ts'
import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'

const DARK_INK = '#020a0b'
const WHITE = '#ffffff'
const BLACK = '#000000'
const LIGHT_CANVAS = '#eef4f0'
const DARK_SURFACE = '#0d0f12'
const MIN_TEXT_CONTRAST = 4.5

function parseHex(value: string): Rgb {
    return [
        Number.parseInt(value.slice(1, 3), 16),
        Number.parseInt(value.slice(3, 5), 16),
        Number.parseInt(value.slice(5, 7), 16),
    ]
}

function toHex(channels: Rgb): string {
    return (
        '#' + channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')
    )
}

function mix(first: string, second: string, amount: number): string {
    const left = parseHex(first)
    const right = parseHex(second)
    return toHex([
        left[0] + (right[0] - left[0]) * amount,
        left[1] + (right[1] - left[1]) * amount,
        left[2] + (right[2] - left[2]) * amount,
    ])
}

function relativeLuminance(value: string): number {
    const channels = parseHex(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

export function accentContrastRatio(first: string, second: string): number {
    const firstLuminance = relativeLuminance(first)
    const secondLuminance = relativeLuminance(second)
    const lighter = Math.max(firstLuminance, secondLuminance)
    const darker = Math.min(firstLuminance, secondLuminance)
    return (lighter + 0.05) / (darker + 0.05)
}

function ensureContrast(color: string, background: string): string {
    if (accentContrastRatio(color, background) >= MIN_TEXT_CONTRAST) return color

    const target = relativeLuminance(background) > 0.18 ? BLACK : WHITE
    let low = 0
    let high = 1
    for (let index = 0; index < 24; index += 1) {
        const middle = (low + high) / 2
        if (accentContrastRatio(mix(color, target, middle), background) >= MIN_TEXT_CONTRAST) {
            high = middle
        } else {
            low = middle
        }
    }
    return mix(color, target, high)
}

const DEFAULT_PALETTE: AccentPalette = {
    accent: DEFAULT_ACCENT_COLOR,
    brand300: '#65f586',
    brand400: '#4ee99a',
    brand500: DEFAULT_ACCENT_COLOR,
    brand600: '#0fb33a',
    brand700: '#0c7f2d',
    foreground: DARK_INK,
    hover: '#65f586',
    active: '#0fb33a',
    textLight: '#0c7f2d',
    textDark: '#65f586',
    rgb: '48 238 97',
}

export function deriveAccentPalette(value: string): AccentPalette {
    const accent = /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() : DEFAULT_ACCENT_COLOR
    if (accent === DEFAULT_ACCENT_COLOR) return DEFAULT_PALETTE

    const foreground =
        accentContrastRatio(accent, BLACK) >= accentContrastRatio(accent, WHITE) ? BLACK : WHITE
    const hoverTarget =
        relativeLuminance(accent) > 0.85 ? BLACK : foreground === BLACK ? WHITE : BLACK
    const brand300 = ensureContrast(mix(accent, WHITE, 0.28), DARK_SURFACE)
    const brand400 = ensureContrast(mix(accent, WHITE, 0.16), DARK_SURFACE)
    const brand700 = ensureContrast(mix(accent, BLACK, 0.25), LIGHT_CANVAS)
    const channels = parseHex(accent)

    return {
        accent,
        brand300,
        brand400,
        brand500: accent,
        brand600: mix(accent, BLACK, 0.18),
        brand700,
        foreground,
        hover: ensureContrast(mix(accent, hoverTarget, 0.14), foreground),
        active: ensureContrast(mix(accent, hoverTarget, 0.25), foreground),
        textLight: brand700,
        textDark: ensureContrast(accent, DARK_SURFACE),
        rgb: channels.join(' '),
    }
}

export function accentCssVariables(value: string): Record<string, string> {
    const palette = deriveAccentPalette(value)
    return {
        '--accent': palette.accent,
        '--accent-300': palette.brand300,
        '--accent-400': palette.brand400,
        '--accent-500': palette.brand500,
        '--accent-600': palette.brand600,
        '--accent-700': palette.brand700,
        '--accent-foreground': palette.foreground,
        '--accent-hover': palette.hover,
        '--accent-active': palette.active,
        '--accent-text-light': palette.textLight,
        '--accent-text-dark': palette.textDark,
        '--accent-rgb': palette.rgb,
    }
}
