import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import type {
    ProxyHttpSettings,
    ProxyHostConfigEditorData,
} from '../../../../shared/Types/proxy-runtime.types'
import {
    getProxyHostConfigEditorHandler,
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

/** Manages the per-host proxy configuration query, mutations, and local draft state. */
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
        baseRevision: string
    } | null>(null)
    const [isResetConfirmationOpen, setResetConfirmationOpen] = useState(false)
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
    const setSetting = useCallback(
        (key: keyof ProxyHttpSettings, value: number | undefined) => {
            if (!canEdit || !data || baseRevision === null) return
            const next = { ...settings }
            if (value === undefined) delete next[key]
            else next[key] = value
            setDraft({ settings: next, baseRevision })
        },
        [baseRevision, canEdit, data, settings],
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
                toast.error(result.message)
                return
            }
            await invalidate()
            setDraft(null)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
            onOpenChange(false)
        },
        onError: () => {
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const resetMutation = useMutation({
        mutationFn: () =>
            resetProxyHostConfigEditorHandler({
                data: { proxyHostId: proxyHost.id, baseRevision: baseRevision ?? '' },
            }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }
            await invalidate()
            setDraft(null)
            setResetConfirmationOpen(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](result.message)
            onOpenChange(false)
        },
        onError: () => {
            toast.error('admin.proxyHosts.config.errors.saveFailed')
        },
    })
    const save = useCallback(() => {
        if (canEdit && baseRevision !== null && !saveMutation.isPending && !resetMutation.isPending)
            saveMutation.mutate(settings)
    }, [baseRevision, canEdit, resetMutation, saveMutation, settings])
    const reset = useCallback(() => {
        if (
            canEdit &&
            baseRevision !== null &&
            !saveMutation.isPending &&
            !resetMutation.isPending
        ) {
            setResetConfirmationOpen(true)
        }
    }, [baseRevision, canEdit, resetMutation, saveMutation])
    const state: ProxyConfigEditorState = {
        activeTab,
        settings,
        baseRevision,
        data,
        isError: query.isError,
        isLoading: query.isPending,
        isRefreshing: query.isFetching,
        isResetConfirmationOpen,
        isResetting: resetMutation.isPending,
        isSaving: saveMutation.isPending,
    }
    const handler: ProxyConfigEditorHandlers = {
        confirmReset: async () => {
            await resetMutation.mutateAsync().catch(() => undefined)
        },
        reset,
        save,
        setActiveTab,
        setSetting,
        setResetConfirmationOpen,
    }
    return { state, handler }
}
