import type { NavigationGroupId } from '@/shared/Types/navigation-config.types.ts'
import type { ApplicationNavigationItem } from '../../../Types/application-shell.types.ts'
export interface ApplicationNavigationLogicResult {
    readonly state: {
        readonly groups: readonly {
            readonly id: NavigationGroupId
            readonly items: readonly ApplicationNavigationItem[]
        }[]
        readonly activeGroupId: NavigationGroupId | undefined
        readonly expandedGroupIds: ReadonlySet<NavigationGroupId>
        readonly instanceId: string
    }
    readonly handler: { readonly toggleGroup: (id: NavigationGroupId) => void }
}
