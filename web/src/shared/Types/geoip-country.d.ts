declare module 'geoip-country' {
    export function lookup(ip: string): { readonly country: string } | null
}
