export interface BrandRasterImageProps {
    readonly asset: 'logo' | 'logo-long'
    readonly alt: string
    readonly width: number
    readonly height: number
    readonly wrapperClassName?: string
    readonly imageClassName?: string
}
