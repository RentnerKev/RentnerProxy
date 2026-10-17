import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { DdnsBatch, DdnsPreview, DdnsSnapshot } from '@/lib/Ddns/Types/ddns.types.ts'
import type { DnsConnection } from '@/lib/DnsConnections/Types/dns-connections.types.ts'
import type {
    DdnsActionInput,
    EnableDdnsInput,
    PreviewDdnsInput,
    SaveDdnsInput,
} from './validation.types.ts'
export type DdnsResponse<T> =
    | { readonly success: true; readonly value: T }
    | { readonly success: false; readonly message: string }
export interface DdnsApi {
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
}
export type DdnsConfirmation = 'enable' | 'save' | 'disable' | 'discard' | null
