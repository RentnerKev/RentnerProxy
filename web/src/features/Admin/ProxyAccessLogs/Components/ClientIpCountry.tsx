import useTranslationStore from '../../../../language/useTranslationStore'
import { Tooltip } from '../../../../shared/Tooltip'
import type { ProxyAccessLogEntry } from '../../../../shared/Types/proxy-access-logs.types'

export default function ClientIpCountry({ entry }: { readonly entry: ProxyAccessLogEntry }) {
    const { locale } = useTranslationStore()
    const code = entry.countryCode
    const country =
        code && /^[A-Z]{2}$/u.test(code)
            ? new Intl.DisplayNames([locale], { type: 'region' }).of(code)
            : undefined

    return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {entry.clientIp}
            {country && code ? (
                <Tooltip content={country}>
                    <span className={`fi fi-${code.toLowerCase()} shrink-0 rounded-[2px]`}>
                        <span className="sr-only">{country}</span>
                    </span>
                </Tooltip>
            ) : null}
        </span>
    )
}
