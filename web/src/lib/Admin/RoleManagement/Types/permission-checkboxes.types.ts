import type { PERMISSION_REGISTRY } from '@/config/permissions.config.ts'

export interface PermissionGroup {
    readonly label: string
    readonly prefix: string
    readonly permissions: ReadonlyArray<(typeof PERMISSION_REGISTRY)[number]>
}
