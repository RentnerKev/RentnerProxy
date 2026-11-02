import type { OidcProviderSummary } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type useOidcProviderForm from '../Hooks/useOidcProviderForm.ts'
export interface ProviderDraft {
    id: string
    name: string
    enabled: boolean
    issuer: string
    clientId: string
    clientSecret: string
    tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post'
    endpointOrigins: string
    privateCidrs: string
    bindings: {
        rowId: string
        subject: string
        userId: string
        roleSource?: 'local' | 'provider' | undefined
        generation?: number | undefined
    }[]
    accountPolicy?: OidcProviderSummary['accountPolicy']
}
export interface OidcProvidersLogicResult {
    state: {
        providers: OidcProviderSummary[]
        callbackUrl: string | null
        isLoading: boolean
        isPending: boolean
        editorOpen: boolean
        editing: OidcProviderSummary | null
        deleteTarget: OidcProviderSummary | null
        conflict: boolean
        revision: number | null
        userOptions: { value: string; label: string; disabled?: boolean }[]
        reloadConfirm: boolean
        isAvailable: boolean
        reauthOpen: boolean
        credential: string
        reauthPending: boolean
    }
    handler: {
        handleCreate: () => void
        handleEdit: (provider: OidcProviderSummary) => void
        handleClose: () => void
        handleSave: () => Promise<void>
        handleRefresh: () => Promise<void>
        handleTest: (provider: OidcProviderSummary) => Promise<void>
        handleCopy: () => Promise<void>
        handleDelete: (provider: OidcProviderSummary | null) => void
        handleConfirmDelete: () => Promise<void>
        handleReauthenticate: (passkey?: boolean) => Promise<void>
        handleReauthClose: () => void
        handleReloadConfirm: (open: boolean) => void
        handleReload: () => Promise<void>
        handleCredential: (value: string) => void
    }
    form: ReturnType<typeof useOidcProviderForm>
}
