import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { ProxyHttpSettings } from '../../../../shared/Types/proxy-runtime.types'
import {
    getProxyConfigEditorHandler,
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
    const [activeTab, setActiveTab] = useState<'edit' | 'active'>('edit')
    const [draft, setDraft] = useState<{
        settings: ProxyHttpSettings
        baseline: ProxyHttpSettings
        baseRevision: string
    } | null>(null)
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
            if (!canEdit || query.isFetching || !data || baseRevision === null) return
            const next = { ...settings }
            if (value === undefined) delete next[key]
            else next[key] = value
            setDraft({ settings: next, baseline: draft?.baseline ?? data.settings, baseRevision })
            setActionError(null)
        },
        [baseRevision, canEdit, data, draft, query.isFetching, settings],
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
            onOpenChange(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
        },
        onError: () => {
            setActionError('admin.proxyHosts.config.errors.saveFailed')
            toast.error('admin.proxyHosts.config.errors.saveFailed')
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
            onOpenChange(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
        },
        onError: () => {
            setActionError('admin.proxyHosts.config.errors.saveFailed')
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const state: ProxyGlobalConfigEditorState = {
        actionError,
        activeTab,
        settings,
        baseRevision,
        data,
        isLoading: query.isPending,
        isRefreshing: query.isFetching,
        isSaving: saveMutation.isPending,
        isResetting: resetMutation.isPending,
    }
    return {
        state,
        handler: {
            save: () => {
                if (canEdit && !query.isFetching && baseRevision && !saveMutation.isPending)
                    saveMutation.mutate()
            },
            reset: () => {
                if (canEdit && !query.isFetching && baseRevision && !resetMutation.isPending)
                    resetMutation.mutate()
            },
            setActiveTab,
            setSetting,
        },
    }
}
