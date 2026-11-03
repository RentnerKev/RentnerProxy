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
        message: string | null
        isPending: boolean
        isNavigating: boolean
        action: OidcConnectionAction | null
        credential: string
        isReauthenticationPending: boolean
    }
    refs: { form: RefObject<HTMLFormElement | null> }
    setter: { setCredential: (value: string) => void }
    handler: {
        handleRequest: (providerId: string, kind: 'link' | 'unlink') => void
        handleCancelNavigation: () => void
        handleClose: () => void
        handleOpenChange: (open: boolean) => void
        handlePassword: () => void
        handlePasskey: () => void
        handleRefresh: () => void
    }
}
