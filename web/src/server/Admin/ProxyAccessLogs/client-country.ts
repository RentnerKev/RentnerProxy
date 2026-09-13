import { isIP } from 'node:net'
import { lookup } from 'geoip-country'

export function clientCountryCode(ip: string): string | null {
    if (!isIP(ip)) return null
    const country = lookup(ip)?.country
    return country && /^[A-Z]{2}$/u.test(country) ? country : null
}
