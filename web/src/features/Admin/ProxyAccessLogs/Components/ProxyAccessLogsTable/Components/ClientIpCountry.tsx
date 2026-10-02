import CountryFlag from '@/shared/Components/CountryFlag.tsx'
import type { ProxyAccessLogEntry } from '@/shared/Types/proxy-access-logs.types.ts'

export default function ClientIpCountry({ entry }: { readonly entry: ProxyAccessLogEntry }) {
    return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
            {entry.clientIp}
            <CountryFlag code={entry.countryCode} />
        </span>
    )
}
