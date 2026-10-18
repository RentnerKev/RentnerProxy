import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { hasFlag } from 'country-flag-icons'
import { version } from 'country-flag-icons/package.json'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { CountryFlagProps } from './Types/country-flag.types.ts'

export default function CountryFlag({
    code,
    decorative = false,
    className = 'h-4 w-6 shrink-0 rounded-[2px]',
}: CountryFlagProps) {
    const { locale } = useTranslationStore()
    if (!code || !/^[A-Z]{2}$/u.test(code) || !hasFlag(code)) return null
    const country = new Intl.DisplayNames([locale], { type: 'region' }).of(code)
    if (!country) return null
    const image = (
        <img
            src={`/assets/country-flags/${version}/${code}.svg`}
            alt={decorative ? '' : country}
            aria-hidden={decorative || undefined}
            width={24}
            height={16}
            loading="lazy"
            decoding="async"
            className={className}
        />
    )
    if (decorative) return image
    return (
        <CustomTooltip collisionPadding={10} content={country}>
            {image}
        </CustomTooltip>
    )
}
