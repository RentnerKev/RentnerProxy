import type { DdnsBatch, DdnsDraft, DdnsSnapshot } from '@/lib/Ddns/Types/ddns.types.ts'
import type { ControllerRequestOptions } from './transport.types.ts'
interface DdnsControllerAction {
    readonly actorUserId: string
    readonly expectedRevision: number
}
export interface DdnsController {
    status(): Promise<DdnsSnapshot>
    preview(input: {
        readonly actorUserId: string
        readonly ipv4: boolean
        readonly ipv6: boolean
        readonly targets: DdnsDraft['targets']
    }): Promise<DdnsBatch>
    save(
        input: DdnsControllerAction & {
            readonly configuration: DdnsDraft & { readonly enabled: boolean }
        },
    ): Promise<DdnsSnapshot>
    enable(input: DdnsControllerAction): Promise<DdnsSnapshot>
    disable(input: DdnsControllerAction): Promise<DdnsSnapshot>
    sync(input: DdnsControllerAction): Promise<DdnsBatch>
}
export type DdnsControllerRequest = (
    path: `/internal/v1/ddns/${'status' | 'config' | 'preview' | 'enable' | 'disable' | 'sync'}`,
    options: ControllerRequestOptions,
) => Promise<unknown>
