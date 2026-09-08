import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import type {
    ProxyHttpSettings,
    ProxyHostConfigEditorData,
    ProxyConfigSource,
} from '../../../../shared/Types/proxy-runtime.types'
import {
    getProxyHostConfigEditorHandler,
    previewProxyHostConfigEditorHandler,
    resetProxyHostConfigEditorHandler,
    saveProxyHostConfigEditorHandler,
} from '../server'
import { proxyHostManagementQueryKeys } from '../queryKeys'
import type {
    ProxyConfigEditorHandlers,
    ProxyConfigEditorLogic,
    ProxyConfigEditorLogicProps,
    ProxyConfigEditorState,
    ProxyConfigEditorTab,
} from '../Types/proxy-config-editor.types'

const EMPTY_SETTINGS: ProxyHttpSettings = {}

export default function useProxyConfigEditorLogic({
    canEdit,
    onOpenChange,
    open,
    proxyHost,
}: ProxyConfigEditorLogicProps): ProxyConfigEditorLogic {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<ProxyConfigEditorTab>('edit')
    const [draft, setDraft] = useState<{
        settings: ProxyHttpSettings
        baseline: ProxyHttpSettings
        baseRevision: string
    } | null>(null)
    const [preview, setPreview] = useState<ProxyConfigSource | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [isResetConfirmationOpen, setResetConfirmationOpen] = useState(false)
    const [isReloadConfirmationOpen, setReloadConfirmationOpen] = useState(false)
    const queryKey = proxyHostManagementQueryKeys.hostConfigEditor(proxyHost.id)
    const query = useQuery({
        queryKey,
        queryFn: () => getProxyHostConfigEditorHandler({ data: { proxyHostId: proxyHost.id } }),
        enabled: open,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const data = query.data as ProxyHostConfigEditorData | undefined
    const settings = draft?.settings ?? data?.settings ?? EMPTY_SETTINGS
    const baseRevision = draft?.baseRevision ?? data?.baseRevision ?? null
    const isDirty =
        draft !== null && JSON.stringify(draft.settings) !== JSON.stringify(draft.baseline)
    const clearErrors = useCallback(() => {
        setActionError(null)
        setPreviewError(null)
    }, [])
    const setSetting = useCallback(
        (key: keyof ProxyHttpSettings, value: number | undefined) => {
            if (!canEdit || !data || baseRevision === null) return
            const next = { ...settings }
            if (value === undefined) delete next[key]
            else next[key] = value
            setDraft({ settings: next, baseline: draft?.baseline ?? data.settings, baseRevision })
            setPreview(null)
            clearErrors()
        },
        [baseRevision, canEdit, clearErrors, data, draft, settings],
    )
    const invalidate = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey }),
            queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.runtimeStatus }),
        ])
    }, [queryClient, queryKey])
    const saveMutation = useMutation({
        mutationFn: (value: ProxyHttpSettings) =>
            saveProxyHostConfigEditorHandler({
                data: {
                    proxyHostId: proxyHost.id,
                    baseRevision: baseRevision ?? '',
                    settings: value,
                },
            }),
        onSuccess: async (result) => {
            if (!result.success) {
                setActionError(result.message)
                toast.error(result.message)
                return
            }
            await invalidate()
            setDraft(null)
            setPreview(null)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
            onOpenChange(false)
        },
        onError: () => {
            setActionError('admin.proxyHosts.config.errors.saveFailed')
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const previewMutation = useMutation({
        mutationFn: (value: ProxyHttpSettings) =>
            previewProxyHostConfigEditorHandler({
                data: { proxyHostId: proxyHost.id, settings: value },
            }),
        onSuccess: (result) => {
            setPreview(result)
            setActiveTab('preview')
            setPreviewError(null)
        },
        onError: () => {
            setPreview(null)
            setPreviewError('admin.proxyHosts.config.errors.previewFailed')
        },
    })
    const resetMutation = useMutation({
        mutationFn: () =>
            resetProxyHostConfigEditorHandler({
                data: { proxyHostId: proxyHost.id, baseRevision: baseRevision ?? '' },
            }),
        onSuccess: async (result) => {
            if (!result.success) {
                setActionError(result.message)
                toast.error(result.message)
                return
            }
            await invalidate()
            setDraft(null)
            setPreview(null)
            setResetConfirmationOpen(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
            onOpenChange(false)
        },
        onError: () => {
            setActionError('admin.proxyHosts.config.errors.saveFailed')
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const save = useCallback(() => {
        if (canEdit && baseRevision !== null && !saveMutation.isPending && !resetMutation.isPending)
            saveMutation.mutate(settings)
    }, [baseRevision, canEdit, resetMutation, saveMutation, settings])
    const previewSettings = useCallback(() => {
        if (
            canEdit &&
            baseRevision !== null &&
            !previewMutation.isPending &&
            !saveMutation.isPending
        )
            previewMutation.mutate(settings)
    }, [baseRevision, canEdit, previewMutation, saveMutation, settings])
    const reset = useCallback(() => {
        if (
            canEdit &&
            baseRevision !== null &&
            !saveMutation.isPending &&
            !resetMutation.isPending
        ) {
            clearErrors()
            setResetConfirmationOpen(true)
        }
    }, [baseRevision, canEdit, clearErrors, resetMutation, saveMutation])
    const reload = useCallback(async () => {
        const result = await query.refetch()
        if (result.isError || !result.data) {
            toast.error('admin.proxyHosts.config.errors.loadFailed')
            return
        }
        setDraft(null)
        setPreview(null)
        setReloadConfirmationOpen(false)
    }, [query, toast])
    const refresh = useCallback(() => {
        if (isDirty) setReloadConfirmationOpen(true)
        else void reload()
    }, [isDirty, reload])
    const state: ProxyConfigEditorState = {
        actionError,
        activeTab,
        settings,
        baseRevision,
        data,
        isError: query.isError,
        isLoading: query.isPending,
        isPreviewing: previewMutation.isPending,
        isRefreshing: query.isFetching,
        isReloadConfirmationOpen,
        isResetConfirmationOpen,
        isResetting: resetMutation.isPending,
        isSaving: saveMutation.isPending,
        preview,
        previewError,
        isDirty,
    }
    const handler: ProxyConfigEditorHandlers = {
        confirmReload: reload,
        confirmReset: async () => {
            await resetMutation.mutateAsync().catch(() => undefined)
        },
        preview: previewSettings,
        refresh,
        reset,
        save,
        setActiveTab,
        setSetting,
        setReloadConfirmationOpen,
        setResetConfirmationOpen,
    }
    return { state, handler }
}
