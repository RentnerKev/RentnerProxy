import { z } from 'zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { createOidcProviderId } from '@/lib/Auth/Oidc/providerId.ts'
import { getUsersHandler } from '@/features/Admin/UserManagement/middleware.ts'
import { getRolesHandler } from '@/features/Admin/RoleManagement/middleware.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    OidcProviderSummary,
    OidcProvidersSummary,
} from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import { saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'
import {
    providerDraft,
    accountPolicyDraft,
    providerInput,
    providersResponseSchema,
    providerTestResponseSchema,
} from '../validation.ts'
import useOidcProviderForm from './useOidcProviderForm.ts'
import type {
    OidcProvidersLogicResult,
    ProviderAccountPolicyDraft,
    ProviderDraft,
} from '../Types/oidc-providers.types.ts'

class ProviderRequestError extends Error {}
class ProviderSecretRequiredError extends Error {}

/** Disables response caching and validates provider API data before it enters the UI. */
async function request<T>(schema: z.ZodType<T>, path = '', body?: unknown): Promise<T> {
    const response = await fetch(`/api/admin/oidc/providers${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const result: unknown = await response.json()
    if (!response.ok) {
        const error = z.object({ error: z.string() }).safeParse(result)
        throw new ProviderRequestError(
            error.success ? error.data.error : 'configuration_unavailable',
        )
    }
    const parsed = schema.safeParse(result)
    if (!parsed.success) throw new ProviderRequestError('configuration_unavailable')
    return parsed.data
}
const key = ['admin', 'oidc-providers'] as const

/** Coordinates live provider snapshots while retaining unsaved drafts. */
export default function useOidcProvidersLogic(): OidcProvidersLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [testing, setTesting] = useState(false)
    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<OidcProviderSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<OidcProviderSummary | null>(null)
    const [conflict, setConflict] = useState(false)
    const [baseRevision, setBaseRevision] = useState<number | null>(null)
    const busy = useRef(false)
    /** Maps server error codes to safe UI feedback and opens the recovery state when needed. */
    const report = useCallback(
        (error: unknown) => {
            if (error instanceof ProviderSecretRequiredError) {
                toast.error(t('oidc.errors.secret'), { title: t('toast.titles.error') })
                return
            }
            const code =
                error instanceof ProviderRequestError ? error.message : 'configuration_unavailable'
            const known = [
                'authentication_required',
                'owner_required',
                'configuration_conflict',
                'invalid_input',
                'identity_not_allowed',
                'rate_limited',
                'provider_unavailable',
                'configuration_unavailable',
            ]
            toast.error(
                t(`oidc.errors.${known.includes(code) ? code : 'configuration_unavailable'}`),
                { title: t('toast.titles.error') },
            )
            if (code === 'configuration_conflict') setConflict(true)
        },
        [t],
    )
    const query = useQuery({
        queryKey: key,
        queryFn: () => request(providersResponseSchema),
        retry: false,
    })
    const users = useQuery({
        queryKey: ['admin', 'oidc-binding-users'],
        queryFn: () => getUsersHandler(),
        retry: false,
    })
    const roles = useQuery({
        queryKey: ['admin', 'oidc-binding-roles'],
        queryFn: () => getRolesHandler(),
        retry: false,
    })
    const [defaultValues, setDefaultValues] = useState(providerDraft)
    const form = useOidcProviderForm(defaultValues, handleSave)
    const resetDraft = useCallback(
        (values: ProviderDraft) => {
            setDefaultValues(values)
            form.reset(values)
        },
        [form],
    )
    /** Initializes optional policy only after an explicit edit; disabling JIT retains role synchronization. */
    function updatePolicy(
        update: (policy: ProviderAccountPolicyDraft) => ProviderAccountPolicyDraft,
    ) {
        if (busy.current || !roles.isSuccess || roles.isError) return
        form.setFieldValue(
            'accountPolicy',
            update(form.state.values.accountPolicy ?? accountPolicyDraft()),
        )
    }
    const formRef = useRef(form)
    useEffect(
        () => () => {
            formRef.current.reset(providerDraft())
        },
        [],
    )
    /** Closes an idle editor and clears its draft and conflict state. */
    function close() {
        if (busy.current) return
        resetDraft(providerDraft())
        setEditorOpen(false)
        setEditing(null)
        setConflict(false)
    }
    const mutation = useMutation({
        /** Builds a revisioned full snapshot while requiring secrets for new or changed trust. */
        mutationFn: async (operation: 'save' | 'delete') => {
            if (conflict) throw new ProviderRequestError('configuration_conflict')
            if (!query.data || query.isError || baseRevision === null)
                throw new ProviderRequestError('configuration_unavailable')
            const providers = query.data.providers
                .filter(
                    (provider) =>
                        provider.id !==
                        (operation === 'save' ? form.state.values.id : deleteTarget?.id),
                )
                .map(
                    ({ revision: _revision, credentialConfigured: _credential, ...provider }) =>
                        provider,
                )
            const draft = form.state.values
            const trustChanged =
                editing &&
                (editing.issuer !== draft.issuer ||
                    editing.clientId !== draft.clientId ||
                    editing.tokenEndpointAuthMethod !== draft.tokenEndpointAuthMethod ||
                    JSON.stringify(editing.allowedEndpointOrigins) !==
                        JSON.stringify(providerInput(draft).allowedEndpointOrigins) ||
                    JSON.stringify(editing.allowedPrivateCidrs) !==
                        JSON.stringify(providerInput(draft).allowedPrivateCidrs))
            if (
                operation === 'save' &&
                (!editing?.credentialConfigured || trustChanged) &&
                !draft.clientSecret
            ) {
                throw new ProviderSecretRequiredError()
            }
            const input = {
                expectedRevision: baseRevision,
                providers:
                    operation === 'save'
                        ? [...providers, providerInput(form.state.values)]
                        : providers,
            }
            const parsed = saveOidcProvidersSchema.safeParse(input)
            if (!parsed.success) throw new ProviderRequestError('invalid_input')
            const result = await request(providersResponseSchema, '', parsed.data)
            queryClient.setQueryData<z.infer<typeof providersResponseSchema>>(key, (current) =>
                current && current.revision > result.revision ? current : result,
            )
            return result
        },
        retry: false,
        gcTime: 0,
    })
    /** Applies a save or delete once, then clears transient form and mutation state. */
    async function run(operation: 'save' | 'delete') {
        if (busy.current || conflict) return
        busy.current = true
        try {
            await mutation.mutateAsync(operation)
            resetDraft(providerDraft())
            setEditorOpen(false)
            setEditing(null)
            setDeleteTarget(null)
            setConflict(false)
            toast.success(t('oidc.saved'), { title: t('toast.titles.success') })
        } catch (error) {
            report(error)
            if (error instanceof ProviderRequestError && error.message === 'configuration_conflict')
                await query.refetch()
        } finally {
            busy.current = false
            mutation.reset()
        }
    }
    async function handleSave() {
        await run('save')
    }
    const synchronizeDraft = useCallback(
        (snapshot: Pick<OidcProvidersSummary, 'providers' | 'revision'>) => {
            if (editorOpen && editing) {
                const provider = snapshot.providers.find((item) => item.id === editing.id)
                if (JSON.stringify(provider) !== JSON.stringify(editing)) {
                    if (form.state.isDirty) {
                        setConflict(true)
                        return
                    }
                    if (!provider) {
                        resetDraft(providerDraft())
                        setEditorOpen(false)
                        setEditing(null)
                    } else {
                        resetDraft(providerDraft(provider))
                        setEditing(provider)
                    }
                }
            }
            if (deleteTarget) {
                const provider = snapshot.providers.find((item) => item.id === deleteTarget.id)
                if (JSON.stringify(provider) !== JSON.stringify(deleteTarget))
                    setDeleteTarget(provider ?? null)
            }
            setBaseRevision(snapshot.revision)
            setConflict(false)
        },
        [form, editorOpen, editing, deleteTarget, resetDraft],
    )
    useEffect(() => {
        return queryClient.getQueryCache().subscribe((event) => {
            if (
                event.type !== 'updated' ||
                event.action.type !== 'success' ||
                event.query.queryKey.length !== key.length ||
                !key.every((part, index) => event.query.queryKey[index] === part)
            )
                return
            const snapshot = providersResponseSchema.safeParse(event.query.state.data)
            if (snapshot.success) synchronizeDraft(snapshot.data)
        })
    }, [queryClient, synchronizeDraft])

    /** Discards only the local draft; the current server snapshot is already synchronized. */
    function discard() {
        if (busy.current || !query.data || query.isError) return
        const provider = query.data.providers.find((item) => item.id === form.state.values.id)
        if (editing && !provider) {
            close()
            return
        }
        resetDraft(providerDraft(provider))
        setEditing(provider ?? null)
        setBaseRevision(query.data.revision)
        setConflict(false)
    }
    /** Tests the selected provider against the current server revision without changing its draft. */
    async function handleTest(provider: OidcProviderSummary) {
        if (busy.current || !query.data || query.isError) return
        busy.current = true
        setTesting(true)
        try {
            await request(providerTestResponseSchema, '/test', {
                providerId: provider.id,
                expectedRevision: query.data.revision,
            })
            toast.success(t('oidc.tested'), { title: t('toast.titles.success') })
        } catch (error) {
            report(error)
        } finally {
            busy.current = false
            setTesting(false)
        }
    }
    const eligibleRoles = new Set(
        (roles.data ?? [])
            .filter((role) => role.permissionKeys.includes(PERMISSIONS.APP_ACCESS))
            .map((role) => role.key),
    )
    const eligibleUsers = (users.data ?? []).filter(
        (user) => user.status === 'active' && user.roleKeys.some((role) => eligibleRoles.has(role)),
    )
    const options = eligibleUsers.map((user) => ({
        value: user.id,
        label: `${user.displayName} (${user.email})`,
    }))
    const boundIds = new Set(
        query.data?.providers.flatMap((provider) =>
            provider.bindings.map((binding) => binding.userId),
        ) ?? [],
    )
    const retained = [...boundIds]
        .filter((id) => !eligibleUsers.some((user) => user.id === id))
        .map((id) => ({ value: id, label: `${t('oidc.unavailableUser')} (${id})`, disabled: true }))
    return {
        form,
        state: {
            providers: query.data?.providers ?? [],
            callbackUrl: query.data?.callbackUrl ?? null,
            isLoading: query.isPending,
            isPending: mutation.isPending || testing,
            editorOpen,
            editing,
            deleteTarget,
            conflict,
            revision: query.data?.revision ?? null,
            userOptions: [...options, ...retained],
            roleOptions: (roles.data ?? [])
                .filter((role) => role.key !== SYSTEM_ROLES.OWNER)
                .map((role) => ({
                    value: role.key,
                    label: role.isSystem
                        ? t(`systemRoles.${role.key}.name`)
                        : role.name || role.key,
                })),
            rolesAvailable: roles.isSuccess && !roles.isError,
            isAvailable: Boolean(query.data && !query.isError),
            hasLoadError: query.isError,
        },
        handler: {
            /** Starts a draft only while an owner snapshot is available and current. */
            handleCreate: () => {
                if (!query.data || query.isError || busy.current) return
                resetDraft(providerDraft())
                setEditing(null)
                setBaseRevision(query.data?.revision ?? null)
                setConflict(false)
                setEditorOpen(true)
            },
            /** Copies the provider configuration into an isolated draft at the loaded revision. */
            handleEdit: (provider) => {
                if (busy.current) return
                resetDraft(providerDraft(provider))
                setEditing(provider)
                setBaseRevision(query.data?.revision ?? null)
                setConflict(false)
                setEditorOpen(true)
            },
            handleClose: close,
            handleSave,
            handleTest,
            /** Copies the canonical callback URL, reporting clipboard failures to the user. */
            handleCopy: async () => {
                try {
                    if (query.data?.callbackUrl) {
                        await navigator.clipboard.writeText(query.data.callbackUrl)
                        toast.success(t('oidc.copied'), { title: t('toast.titles.success') })
                    }
                } catch {
                    toast.error(t('oidc.errors.copy'), { title: t('toast.titles.error') })
                }
            },
            /** Captures a delete target and its base revision for the confirmation flow. */
            handleDelete: (provider) => {
                if (!busy.current) {
                    setDeleteTarget(provider)
                    setBaseRevision(query.data?.revision ?? null)
                    setConflict(false)
                }
            },
            handleConfirmDelete: () => run('delete'),
            handleDiscard: discard,
            handlePolicyProvisioning: (provisioning) =>
                updatePolicy((policy) => ({ ...policy, provisioning })),
            handlePolicyGroupClaim: (groupClaim) =>
                updatePolicy((policy) => ({ ...policy, groupClaim })),
            handlePolicyDefaultRoles: (defaultRoleKeys) =>
                updatePolicy((policy) => ({ ...policy, defaultRoleKeys })),
            handleAddMapping: () =>
                updatePolicy((policy) =>
                    policy.groupRoleMappings.length >= OIDC_LIMITS.groupMappings
                        ? policy
                        : {
                              ...policy,
                              groupRoleMappings: [
                                  ...policy.groupRoleMappings,
                                  { rowId: createOidcProviderId(), group: '', roleKeys: [] },
                              ],
                          },
                ),
            handleRemoveMapping: (rowId) =>
                updatePolicy((policy) => ({
                    ...policy,
                    groupRoleMappings: policy.groupRoleMappings.filter(
                        (mapping) => mapping.rowId !== rowId,
                    ),
                })),
            handleMappingGroup: (rowId, group) =>
                updatePolicy((policy) => ({
                    ...policy,
                    groupRoleMappings: policy.groupRoleMappings.map((mapping) =>
                        mapping.rowId === rowId ? { ...mapping, group } : mapping,
                    ),
                })),
            handleMappingRoles: (rowId, roleKeys) =>
                updatePolicy((policy) => ({
                    ...policy,
                    groupRoleMappings: policy.groupRoleMappings.map((mapping) =>
                        mapping.rowId === rowId ? { ...mapping, roleKeys } : mapping,
                    ),
                })),
        },
    }
}
