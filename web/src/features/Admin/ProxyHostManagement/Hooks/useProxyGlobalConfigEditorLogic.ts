import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import type {
    ProxyHttpSettings,
    ProxyConfigSource,
} from '../../../../shared/Types/proxy-runtime.types'
import {
    getProxyConfigEditorHandler,
    previewProxyConfigEditorHandler,
    resetProxyConfigEditorHandler,
    saveProxyConfigEditorHandler,
} from '../server'
import { proxyHostManagementQueryKeys } from '../queryKeys'
import type {
    ProxyGlobalConfigEditorModalProps,
    ProxyGlobalConfigEditorState,
} from '../Types/proxy-config-editor.types'

const EMPTY_SETTINGS: ProxyHttpSettings = {}

export default function useProxyGlobalConfigEditorLogic({
    canEdit,
    onOpenChange,
    open,
}: ProxyGlobalConfigEditorModalProps) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<'edit' | 'active' | 'defaults' | 'preview'>('edit')
    const [draft, setDraft] = useState<{
        settings: ProxyHttpSettings
        baseline: ProxyHttpSettings
        baseRevision: string
    } | null>(null)
    const [preview, setPreview] = useState<ProxyConfigSource | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const query = useQuery({
        queryKey: proxyHostManagementQueryKeys.configEditor,
        queryFn: () => getProxyConfigEditorHandler(),
        enabled: open,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const data = query.data
    const settings = draft?.settings ?? data?.settings ?? EMPTY_SETTINGS
    const baseRevision = draft?.baseRevision ?? data?.baseRevision ?? null
    const setSetting = useCallback(
        (key: keyof ProxyHttpSettings, value: number | undefined) => {
            if (!canEdit || !data || baseRevision === null) return
            const next = { ...settings }
            if (value === undefined) delete next[key]
            else next[key] = value
            setDraft({ settings: next, baseline: draft?.baseline ?? data.settings, baseRevision })
            setPreview(null)
            setActionError(null)
        },
        [baseRevision, canEdit, data, draft, settings],
    )
    const invalidate = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.configEditor }),
            queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.runtimeStatus }),
        ])
    }, [queryClient])
    const saveMutation = useMutation({
        mutationFn: () =>
            saveProxyConfigEditorHandler({ data: { baseRevision: baseRevision ?? '', settings } }),
        onSuccess: async (result) => {
            if (!result.success) {
                setActionError(result.message)
                toast.error(result.message)
                return
            }
            await invalidate()
            setDraft(null)
            setPreview(null)
            onOpenChange(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
        },
        onError: () => {
            setActionError('admin.proxyHosts.config.errors.saveFailed')
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const previewMutation = useMutation({
        mutationFn: () => previewProxyConfigEditorHandler({ data: { settings } }),
        onSuccess: (result) => {
            setPreview(result)
            setActiveTab('preview')
            setActionError(null)
        },
        onError: () => {
            setPreview(null)
            setActionError('admin.proxyHosts.config.errors.previewFailed')
        },
    })
    const resetMutation = useMutation({
        mutationFn: () =>
            resetProxyConfigEditorHandler({ data: { baseRevision: baseRevision ?? '' } }),
        onSuccess: async (result) => {
            if (!result.success) {
                setActionError(result.message)
                toast.error(result.message)
                return
            }
            await invalidate()
            setDraft(null)
            setPreview(null)
            onOpenChange(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
        },
        onError: () => {
            setActionError('admin.proxyHosts.config.errors.saveFailed')
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const refresh = useCallback(() => {
        void query.refetch().then((result) => {
            if (result.data) {
                setDraft(null)
                setPreview(null)
            }
        })
    }, [query])
    const state: ProxyGlobalConfigEditorState = {
        actionError,
        activeTab,
        settings,
        baseRevision,
        data,
        isLoading: query.isPending,
        isSaving: saveMutation.isPending,
        isResetting: resetMutation.isPending,
        isPreviewing: previewMutation.isPending,
        preview,
    }
    return {
        state,
        handler: {
            refresh,
            save: () => {
                if (canEdit && baseRevision && !saveMutation.isPending) saveMutation.mutate()
            },
            reset: () => {
                if (canEdit && baseRevision && !resetMutation.isPending) resetMutation.mutate()
            },
            preview: () => {
                if (canEdit && baseRevision && !previewMutation.isPending) previewMutation.mutate()
            },
            setActiveTab,
            setSetting,
        },
    }
}
