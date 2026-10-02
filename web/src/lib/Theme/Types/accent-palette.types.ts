export type Rgb = readonly [number, number, number]

export interface AccentPalette {
    readonly accent: string
    readonly brand300: string
    readonly brand400: string
    readonly brand500: string
    readonly brand600: string
    readonly brand700: string
    readonly foreground: string
    readonly hover: string
    readonly active: string
    readonly textLight: string
    readonly textDark: string
    readonly rgb: string
}
