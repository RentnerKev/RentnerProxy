import type { ProxyConfigEditorSubmission } from '../../../Types/proxy-config-editor.types.ts'
import useProxyConfigDraft from '../../../Hooks/useProxyConfigDraft.ts'
import { invalidateProxyHostManagementRuntimeStatusCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    ProxyHttpSettings,
    ProxyHostConfigEditorData,
} from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import {
    getProxyHostConfigEditorHandler,
    resetProxyHostConfigEditorHandler,
    saveProxyHostConfigEditorHandler,
} from '../../../middleware.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import type {
    ProxyConfigEditorHandlers,
    ProxyConfigEditorLogic,
    ProxyConfigEditorLogicProps,
    ProxyConfigEditorState,
    ProxyConfigEditorTab,
} from '../../../Types/proxy-config-editor.types.ts'

/** Manages the per-host proxy configuration query, mutations, and local draft state. */
export default function useProxyConfigEditorLogic({
    canEdit,
    onOpenChange,
    open,
    proxyHost,
}: ProxyConfigEditorLogicProps): ProxyConfigEditorLogic {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<ProxyConfigEditorTab>('edit')
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
    const {
        settings,
        baseRevision,
        hasConflict,
        reviewedLatest,
        isConflictConfirmationOpen,
        updateSetting,
        markConflict,
        clearDraft,
        setReviewedLatest,
        setConflictConfirmationOpen,
        acceptDraft,
        keepDraft,
        useSaved,
    } = useProxyConfigDraft(data)
    const setSetting = (key: keyof ProxyHttpSettings, value: number | undefined) => {
        if (canEdit && !query.isFetching && !saveMutation.isPending && !resetMutation.isPending)
            updateSetting(key, value)
    }
    const reviewLatest = async () => {
        if (
            !canEdit ||
            !hasConflict ||
            query.isFetching ||
            saveMutation.isPending ||
            resetMutation.isPending
        )
            return
        const latest = await query.refetch()
        if (latest.isError || !latest.data) {
            toast.error(t('admin.proxyHosts.config.errors.loadFailed'), {
                title: t('toast.titles.error'),
            })
            return
        }
        setReviewedLatest(latest.data)
    }
    const invalidate = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey }),
            invalidateProxyHostManagementRuntimeStatusCache(queryClient),
        ])
    }, [queryClient, queryKey])
    const saveMutation = useMutation({
        mutationFn: (value: ProxyConfigEditorSubmission) =>
            saveProxyHostConfigEditorHandler({
                data: {
                    proxyHostId: proxyHost.id,
                    baseRevision: value.baseRevision,
                    settings: value.settings,
                },
            }),
        onSuccess: async (result, submitted) => {
            if (!result.success) {
                if (result.message === 'admin.proxyHosts.config.errors.configuration_conflict') {
                    markConflict(submitted)
                    setResetConfirmationOpen(false)
                }
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            clearDraft()
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](t(result.message), {
                title: t(
                    'toast.titles.' + (result.runtimeStatus === 'pending' ? 'warning' : 'success'),
                ),
            })
            onOpenChange(false)
        },
        onError: () => {
            toast.error(t('admin.proxyHosts.config.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })
    const resetMutation = useMutation({
        mutationFn: (value: ProxyConfigEditorSubmission) =>
            resetProxyHostConfigEditorHandler({
                data: { proxyHostId: proxyHost.id, baseRevision: value.baseRevision },
            }),
        onSuccess: async (result, submitted) => {
            if (!result.success) {
                if (result.message === 'admin.proxyHosts.config.errors.configuration_conflict') {
                    markConflict(submitted)
                    setResetConfirmationOpen(false)
                }
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            clearDraft()
            setResetConfirmationOpen(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](t(result.message), {
                title: t(
                    'toast.titles.' + (result.runtimeStatus === 'pending' ? 'warning' : 'success'),
                ),
            })
            onOpenChange(false)
        },
        onError: () => {
            toast.error(t('admin.proxyHosts.config.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })
    const save = useCallback(() => {
        if (
            canEdit &&
            !hasConflict &&
            !query.isFetching &&
            baseRevision !== null &&
            !saveMutation.isPending &&
            !resetMutation.isPending
        )
            saveMutation.mutate({ settings, baseRevision })
    }, [
        baseRevision,
        canEdit,
        hasConflict,
        query.isFetching,
        resetMutation,
        saveMutation,
        settings,
    ])
    const reset = useCallback(() => {
        if (
            canEdit &&
            !hasConflict &&
            !query.isFetching &&
            baseRevision !== null &&
            !saveMutation.isPending &&
            !resetMutation.isPending
        ) {
            setResetConfirmationOpen(true)
        }
    }, [baseRevision, canEdit, hasConflict, query.isFetching, resetMutation, saveMutation])
    const state: ProxyConfigEditorState = {
        hasConflict,
        reviewedLatest: reviewedLatest?.settings ?? null,
        isConflictConfirmationOpen,
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
        reviewLatest,
        keepDraft,
        useSaved,
        acceptDraft,
        setConflictConfirmationOpen,
        confirmReset: async () => {
            if (
                !canEdit ||
                hasConflict ||
                query.isFetching ||
                saveMutation.isPending ||
                resetMutation.isPending
            )
                return
            await resetMutation
                .mutateAsync({ settings, baseRevision: baseRevision ?? '' })
                .catch(() => undefined)
        },
        reset,
        save,
        setActiveTab,
        setSetting,
        setResetConfirmationOpen,
    }
    return { state, handler }
}
