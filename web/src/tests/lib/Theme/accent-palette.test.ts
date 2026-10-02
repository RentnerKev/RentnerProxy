import { describe, expect, test } from 'bun:test'

import {
    accentContrastRatio,
    accentCssVariables,
    deriveAccentPalette,
} from '@/lib/Theme/accentPalette.ts'

describe('system accent palette', () => {
    test('keeps the existing green palette exactly when no color is configured', () => {
        expect(deriveAccentPalette('#30ee61')).toEqual({
            accent: '#30ee61',
            brand300: '#65f586',
            brand400: '#4ee99a',
            brand500: '#30ee61',
            brand600: '#0fb33a',
            brand700: '#0d8a31',
            foreground: '#020a0b',
            hover: '#65f586',
            active: '#0fb33a',
            textLight: '#0d8a31',
            textDark: '#65f586',
            rgb: '48 238 97',
        })
        expect(deriveAccentPalette('invalid')).toEqual(deriveAccentPalette('#30ee61'))
    })

    test('derives legible foreground and theme text for arbitrary colors', () => {
        for (const color of [
            '#000000',
            '#ffffff',
            '#777777',
            '#808080',
            '#0000ff',
            '#ffff00',
            '#ff0000',
            '#00ffff',
            '#7b2cbf',
        ]) {
            const palette = deriveAccentPalette(color)
            expect(palette.accent).toBe(color)
            expect(accentContrastRatio(palette.accent, palette.foreground)).toBeGreaterThanOrEqual(
                4.5,
            )
            expect(accentContrastRatio(palette.hover, palette.foreground)).toBeGreaterThanOrEqual(
                4.5,
            )
            expect(accentContrastRatio(palette.active, palette.foreground)).toBeGreaterThanOrEqual(
                4.5,
            )
            expect(accentContrastRatio(palette.textLight, '#fbfdfc')).toBeGreaterThanOrEqual(4.5)
            expect(accentContrastRatio(palette.textDark, '#0d0f12')).toBeGreaterThanOrEqual(4.5)
            expect(accentContrastRatio(palette.brand300, '#0d0f12')).toBeGreaterThanOrEqual(4.5)
            expect(accentContrastRatio(palette.brand400, '#0d0f12')).toBeGreaterThanOrEqual(4.5)
            expect(accentContrastRatio(palette.brand700, '#fbfdfc')).toBeGreaterThanOrEqual(4.5)
        }
    })

    test('provides one consistent CSS variable set for SSR and preview', () => {
        const variables = accentCssVariables('#3366cc')
        expect(variables['--accent']).toBe('#3366cc')
        expect(variables['--accent-500']).toBe('#3366cc')
        expect(variables['--accent-rgb']).toBe('51 102 204')
        expect(variables['--accent-foreground']).toBe('#ffffff')
        expect(variables['--accent-hover']).toBeDefined()
    })
})
