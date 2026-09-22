import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { hasFlag } from 'country-flag-icons'

import { TOOLTIP_DEFAULT_PROPS } from '../../../../config/tooltip.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { ProxyAccessLogEntry } from '../../../../shared/Types/proxy-access-logs.types'

export default function ClientIpCountry({ entry }: { readonly entry: ProxyAccessLogEntry }) {
    const { locale } = useTranslationStore()
    const code = entry.countryCode
    const country =
        code && /^[A-Z]{2}$/u.test(code) && hasFlag(code)
            ? new Intl.DisplayNames([locale], { type: 'region' }).of(code)
            : undefined

    return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {entry.clientIp}
            {country && code ? (
                <CustomTooltip {...TOOLTIP_DEFAULT_PROPS} content={country}>
                    <span
                        className={`flag:${code} shrink-0 rounded-[2px] [--CountryFlagIcon-height:1rem]`}
                    >
                        <span className="sr-only">{country}</span>
                    </span>
                </CustomTooltip>
            ) : null}
        </span>
    )
}
