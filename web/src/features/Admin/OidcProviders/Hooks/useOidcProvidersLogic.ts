import { z } from 'zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { startAuthentication } from '@simplewebauthn/browser'
import { toast } from '@rentnerkev/toasts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { getUsersHandler } from '@/features/Admin/UserManagement/middleware.ts'
import { getRolesHandler } from '@/features/Admin/RoleManagement/middleware.ts'
import useReauthentication from '@/features/UserSettings/Components/SecuritySettingsPanel/Hooks/useReauthentication.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { OidcProviderSummary } from '@/lib/Auth/Oidc/Types/oidc-provider.types.ts'
import { saveOidcProvidersSchema } from '@/lib/Auth/Oidc/validation.ts'
import {
    providerDraft,
    providerInput,
    providersResponseSchema,
    providerTestResponseSchema,
} from '../validation.ts'
import useOidcProviderForm from './useOidcProviderForm.ts'
import type { OidcProvidersLogicResult } from '../Types/oidc-providers.types.ts'

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

/** Coordinates revisioned provider edits, explicit reloads, and fresh-owner authentication. */
export default function useOidcProvidersLogic(): OidcProvidersLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [testing, setTesting] = useState(false)
    const [reloadConfirm, setReloadConfirm] = useState(false)
    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<OidcProviderSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<OidcProviderSummary | null>(null)
    const [conflict, setConflict] = useState(false)
    const [reauthOpen, setReauthOpen] = useState(false)
    const [baseRevision, setBaseRevision] = useState<number | null>(null)
    const busy = useRef(false)
    const reauthBusy = useRef(false)
    const reauthentication = useReauthentication()
    /** Maps server error codes to safe UI feedback and opens the recovery state when needed. */
    const report = useCallback(
        (error: unknown) => {
            if (error instanceof ProviderSecretRequiredError) {
                toast.error(t('oidc.errors.secret'))
                return
            }
            const code =
                error instanceof ProviderRequestError ? error.message : 'configuration_unavailable'
            const known = [
                'reauthentication_required',
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
            )
            if (code === 'reauthentication_required') setReauthOpen(true)
            if (code === 'configuration_conflict') setConflict(true)
        },
        [t],
    )
    const query = useQuery({
        queryKey: key,
        /** Reports authorization and revision failures before the query enters its error state. */
        queryFn: async () => {
            try {
                return await request(providersResponseSchema)
            } catch (error) {
                report(error)
                throw error
            }
        },
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
    useEffect(() => {
        if (users.error || roles.error) toast.error(t('oidc.errors.users'))
    }, [users.error, roles.error, t])
    const [defaultValues, setDefaultValues] = useState(providerDraft)
    const form = useOidcProviderForm(defaultValues, handleSave)
    /** Resets both draft state and TanStack Form state so modal sessions cannot inherit secrets. */
    function resetDraft(values: typeof defaultValues) {
        setDefaultValues(values)
        form.reset(values)
    }
    const formRef = useRef(form)
    useEffect(
        () => () => {
            formRef.current.reset(providerDraft())
        },
        [],
    )
    /** Closes an idle editor and clears its draft, conflict, and reauthentication state. */
    function close() {
        if (busy.current) return
        resetDraft(providerDraft())
        setEditorOpen(false)
        setEditing(null)
        setConflict(false)
        reauthentication.handler.reset()
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
            queryClient.setQueryData(key, result)
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
            reauthentication.handler.reset()
            toast.success(t('oidc.saved'))
        } catch (error) {
            report(error)
        } finally {
            busy.current = false
            mutation.reset()
        }
    }
    async function handleSave() {
        await run('save')
    }
    /** Refreshes configuration while preserving an open draft for explicit conflict handling. */
    async function refresh() {
        if (busy.current) return
        if (conflict && (editorOpen || deleteTarget)) {
            setReloadConfirm(true)
            return
        }
        const result = await query.refetch()
        if (result.data && !editorOpen && !deleteTarget) setBaseRevision(result.data.revision)
    }
    /** Replaces the draft only after an explicit reload confirms the latest server revision. */
    async function reload() {
        if (busy.current) return
        const result = await query.refetch()
        if (!result.data || result.error) return
        const provider = result.data.providers.find((item) => item.id === form.state.values.id)
        resetDraft(providerDraft(provider))
        setEditing(provider ?? null)
        if (!provider && editing) setEditorOpen(false)
        setDeleteTarget(null)
        setBaseRevision(result.data.revision)
        setConflict(false)
        setReloadConfirm(false)
        reauthentication.handler.reset()
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
            toast.success(t('oidc.tested'))
        } catch (error) {
            report(error)
        } finally {
            busy.current = false
            setTesting(false)
        }
    }
    /** Reauthenticates with a password or passkey, then reloads the authorized provider snapshot. */
    async function reauthenticate(passkey = false) {
        if (reauthBusy.current) return
        reauthBusy.current = true
        try {
            let result
            if (passkey) {
                const started = await reauthentication.handler.beginPasskey()
                if (!started.success || !started.options || !started.challengeId) {
                    toast.error(t(started.message))
                    return
                }
                const response = await startAuthentication({ optionsJSON: started.options })
                result = await reauthentication.handler.finishPasskey({
                    challengeId: started.challengeId,
                    response,
                })
            } else result = await reauthentication.handler.verifyPassword()
            if (!result.success) {
                toast.error(t(result.message))
                return
            }
            reauthentication.handler.reset()
            setReauthOpen(false)
            await query.refetch()
            toast.success(t('oidc.reauthenticated'))
        } catch {
            toast.error(t('account.reauthentication.error.failed'))
        } finally {
            reauthBusy.current = false
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
            isAvailable: Boolean(query.data && !query.isError && !reauthOpen),
            reloadConfirm,
            reauthOpen,
            credential: reauthentication.state.credential,
            reauthPending: reauthentication.state.isPending,
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
            handleRefresh: refresh,
            handleTest,
            /** Copies the canonical callback URL, reporting clipboard failures to the user. */
            handleCopy: async () => {
                try {
                    if (query.data?.callbackUrl) {
                        await navigator.clipboard.writeText(query.data.callbackUrl)
                        toast.success(t('oidc.copied'))
                    }
                } catch {
                    toast.error(t('oidc.errors.copy'))
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
            handleReauthenticate: reauthenticate,
            handleReloadConfirm: setReloadConfirm,
            handleReload: reload,
            /** Clears local credentials and closes reauthentication only when no challenge is running. */
            handleReauthClose: () => {
                if (!reauthBusy.current) {
                    reauthentication.handler.reset()
                    setReauthOpen(false)
                }
            },
            handleCredential: reauthentication.setter.setCredential,
        },
    }
}
