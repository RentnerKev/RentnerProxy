import { hasFlag } from 'country-flag-icons'
import useTranslationStore from '../../../../language/useTranslationStore'
import { Tooltip } from '../../../../shared/Tooltip'
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
                <Tooltip content={country}>
                    <span
                        className={`flag:${code} shrink-0 rounded-[2px] [--CountryFlagIcon-height:1rem]`}
                    >
                        <span className="sr-only">{country}</span>
                    </span>
                </Tooltip>
            ) : null}
        </span>
    )
}
