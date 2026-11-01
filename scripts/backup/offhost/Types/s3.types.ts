import type { LookupAddress } from 'node:dns'
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http'

export type OffHostS3Target = {
    endpoint: string
    region: string
    bucket: string
    prefix: string
    accessKeyId: string
    secretAccessKey: string
}

/** Test seams never change endpoint validation or production TLS policy. */
export type S3Dependencies = {
    lookup?: (hostname: string) => Promise<LookupAddress[]>
    request?: (
        options: RequestOptions,
        callback: (response: IncomingMessage) => void,
    ) => ClientRequest
}
