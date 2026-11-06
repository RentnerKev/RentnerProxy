export type MediaRequest = (
    method: 'GET' | 'POST' | 'PATCH',
    endpoint: string,
    body?: unknown,
) => Promise<{ status: number; data: unknown }>

export interface ReleaseMediaInput {
    repository: string
    tagName: string
    files: readonly { name: string; bytes: Uint8Array }[]
}

export interface PublishedReleaseMedia {
    commitSha: string
    urls: Record<string, string>
}
