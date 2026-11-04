import type { ImagePlatform } from './Types/image-platform.types.ts'

export function imagePlatform(value: string): ImagePlatform | null {
    if (value === 'linux/amd64') return value
    if (value === 'linux/arm64' || value === 'linux/arm64/v8') return 'linux/arm64'
    return null
}

export function imagePlatforms(values: readonly string[]): ImagePlatform[] | null {
    if (!values.length || values.length > 2) return null
    const platforms = values.map(imagePlatform)
    if (platforms.some((platform) => platform === null)) return null
    const unique = new Set(platforms)
    if (unique.size !== platforms.length) return null
    return platforms as ImagePlatform[]
}
