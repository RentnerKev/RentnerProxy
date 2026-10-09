import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { hasFlag } from 'country-flag-icons'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function CountryFlag({ code }: { readonly code: string | null | undefined }) {
    const { locale } = useTranslationStore()
    if (!code || !/^[A-Z]{2}$/u.test(code) || !hasFlag(code)) return null
    const country = new Intl.DisplayNames([locale], { type: 'region' }).of(code)
    if (!country) return null
    return (
        <CustomTooltip collisionPadding={10} content={country}>
            <span className={`flag:${code} shrink-0 rounded-[2px] [--CountryFlagIcon-height:1rem]`}>
                <span className="sr-only">{country}</span>
            </span>
        </CustomTooltip>
    )
}
