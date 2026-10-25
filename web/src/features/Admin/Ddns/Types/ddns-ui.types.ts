import type { DdnsProviderContext } from '@/lib/DnsConnections/Types/dns-provider.types.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { DdnsBatch, DdnsPreview, DdnsSnapshot } from '@/lib/Ddns/Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type {
    DdnsActionInput,
    EnableDdnsInput,
    PreviewDdnsInput,
    SaveDdnsInput,
    ApplyDdnsInput,
} from './validation.types.ts'
export type DdnsResponse<T> =
    | { readonly success: true; readonly value: T }
    | { readonly success: false; readonly message: string }
export type { DdnsProviderContext } from '@/lib/DnsConnections/Types/dns-provider.types.ts'
export interface DdnsApi {
    apply(input: ApplyDdnsInput): Promise<DdnsResponse<DdnsSnapshot>>
    providers(): Promise<DdnsProviderContext>
    status(): Promise<DdnsSnapshot>
    connections(): Promise<readonly DnsConnection[]>
    preview(input: PreviewDdnsInput): Promise<DdnsResponse<DdnsPreview>>
    save(input: SaveDdnsInput): Promise<DdnsResponse<DdnsSnapshot>>
    enable(input: EnableDdnsInput): Promise<DdnsResponse<DdnsSnapshot>>
    disable(input: DdnsActionInput): Promise<DdnsResponse<DdnsSnapshot>>
    sync(input: DdnsActionInput): Promise<DdnsResponse<DdnsBatch>>
}
export interface DdnsPageProps {
    readonly permissions: readonly PermissionKey[]
    readonly api: DdnsApi
    readonly liveEnabled?: boolean
}
