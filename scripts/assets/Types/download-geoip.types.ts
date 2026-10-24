export type DownloadFetch = (url: string, options: RequestInit) => Promise<Response>

export interface GeoipAsset {
    id: number
    size: number
    digest: string
    url: string
}
