import type { RefObject } from 'react'
import type {
    OidcConnectionAction,
    OidcConnections,
} from '@/lib/UserSettings/Types/oidc-connections.types.ts'

export interface OidcConnectionsPanelProps {
    readonly userId: string
    readonly canUpdate: boolean
}

export interface OidcConnectionsLogicResult {
    state: {
        data: OidcConnections | undefined
        isLoading: boolean
        error: Error | null
        canUpdate: boolean
        isPending: boolean
        isNavigating: boolean
        action: OidcConnectionAction | null
    }
    refs: { form: RefObject<HTMLFormElement | null> }
    handler: {
        handleRequest: (providerId: string, kind: 'link' | 'unlink') => void
        handleCancelNavigation: () => void
    }
}
