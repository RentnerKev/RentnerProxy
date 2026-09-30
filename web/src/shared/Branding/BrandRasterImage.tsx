interface BrandRasterImageProps {
    readonly asset: 'logo' | 'logo-long'
    readonly alt: string
    readonly width: number
    readonly height: number
    readonly wrapperClassName?: string
    readonly imageClassName?: string
}

const assetDetails = {
    logo: {
        src: '/rentnerproxy-logo.png',
        className: "aspect-square [--brand-mask:url('/rentnerproxy-logo-accent-mask.png')]",
    },
    'logo-long': {
        src: '/rentnerproxy-logo-long.png',
        className: "aspect-[8/3] [--brand-mask:url('/rentnerproxy-logo-long-accent-mask.png')]",
    },
} as const

export default function BrandRasterImage({
    asset,
    alt,
    height,
    imageClassName = '',
    width,
    wrapperClassName = '',
}: BrandRasterImageProps) {
    const details = assetDetails[asset]

    return (
        <span className={`relative isolate block ${details.className} ${wrapperClassName}`}>
            <img
                src={details.src}
                alt={alt}
                width={width}
                height={height}
                className={`relative z-0 block size-full object-contain ${imageClassName}`}
            />
            <span
                className="pointer-events-none absolute inset-0 z-10 bg-[var(--accent)] opacity-0 mix-blend-color group-data-[accent-custom=true]:opacity-100 [-webkit-mask-image:var(--brand-mask)] [mask-image:var(--brand-mask)] [-webkit-mask-size:100%_100%] [mask-size:100%_100%] [-webkit-mask-repeat:no-repeat] [mask-repeat:no-repeat]"
                aria-hidden="true"
            />
        </span>
    )
}
