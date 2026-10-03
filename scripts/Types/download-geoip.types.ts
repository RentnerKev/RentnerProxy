export type DownloadFetch = (url: string, options: RequestInit) => Promise<Response>

export type ReleaseAsset = {
    id: number
    name: string
    state: string
    size: number
    digest: string
}
