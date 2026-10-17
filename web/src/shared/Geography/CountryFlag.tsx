import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { hasFlag } from 'country-flag-icons'
import { version } from 'country-flag-icons/package.json'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function CountryFlag({ code }: { readonly code: string | null | undefined }) {
    const { locale } = useTranslationStore()
    if (!code || !/^[A-Z]{2}$/u.test(code) || !hasFlag(code)) return null
    const country = new Intl.DisplayNames([locale], { type: 'region' }).of(code)
    if (!country) return null
    return (
        <CustomTooltip collisionPadding={10} content={country}>
            <img
                src={`/assets/country-flags/${version}/${code}.svg`}
                alt={country}
                width={24}
                height={16}
                loading="lazy"
                decoding="async"
                className="h-4 w-6 shrink-0 rounded-[2px]"
            />
        </CustomTooltip>
    )
}
