export default function countryCodeFromGeoRecord(record: unknown): string | null {
    if (!record || typeof record !== 'object') return null
    const value = record as { country_code?: unknown; country?: { iso_code?: unknown } }
    const code = value.country_code ?? value.country?.iso_code
    return typeof code === 'string' && /^[A-Z]{2}$/u.test(code) ? code : null
}
