import type { OidcProviderSummary } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import type useOidcProviderForm from '../Hooks/useOidcProviderForm.ts'
export interface ProviderAccountPolicyDraft {
    provisioning: boolean
    groupClaim: string
    defaultRoleKeys: string[]
    groupRoleMappings: { rowId: string; group: string; roleKeys: string[] }[]
}
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
    accountPolicy?: ProviderAccountPolicyDraft
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
        roleOptions: { value: string; label: string }[]
        rolesAvailable: boolean
        hasLoadError: boolean
        isAvailable: boolean
    }
    handler: {
        handleCreate: () => void
        handleEdit: (provider: OidcProviderSummary) => void
        handleClose: () => void
        handleSave: () => Promise<void>
        handleTest: (provider: OidcProviderSummary) => Promise<void>
        handleCopy: () => Promise<void>
        handleDelete: (provider: OidcProviderSummary | null) => void
        handleConfirmDelete: () => Promise<void>
        handleDiscard: () => void
        handlePolicyProvisioning: (value: boolean) => void
        handlePolicyGroupClaim: (value: string) => void
        handlePolicyDefaultRoles: (value: string[]) => void
        handleAddMapping: () => void
        handleRemoveMapping: (rowId: string) => void
        handleMappingGroup: (rowId: string, value: string) => void
        handleMappingRoles: (rowId: string, value: string[]) => void
    }
    form: ReturnType<typeof useOidcProviderForm>
}

export interface AccountPolicyEditorProps {
    form: OidcProvidersLogicResult['form']
    state: Pick<OidcProvidersLogicResult['state'], 'isPending' | 'rolesAvailable' | 'roleOptions'>
    handler: Pick<
        OidcProvidersLogicResult['handler'],
        | 'handlePolicyProvisioning'
        | 'handlePolicyGroupClaim'
        | 'handlePolicyDefaultRoles'
        | 'handleAddMapping'
        | 'handleRemoveMapping'
        | 'handleMappingGroup'
        | 'handleMappingRoles'
    >
}
