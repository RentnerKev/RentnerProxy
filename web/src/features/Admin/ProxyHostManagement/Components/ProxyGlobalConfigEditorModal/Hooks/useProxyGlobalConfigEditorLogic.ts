import type { ProxyConfigEditorSubmission } from '../../../Types/proxy-config-editor.types.ts'
import useProxyConfigDraft from '../../../Hooks/useProxyConfigDraft.ts'
import type { ProxyGlobalConfigEditorLogicResult } from '../Types/logic.types.ts'
import { invalidateProxyHostManagementConfigEditorCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { invalidateProxyHostManagementRuntimeStatusCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHttpSettings } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import {
    getProxyConfigEditorHandler,
    resetProxyConfigEditorHandler,
    saveProxyConfigEditorHandler,
} from '../../../middleware.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import type {
    ProxyGlobalConfigEditorModalProps,
    ProxyGlobalConfigEditorState,
} from '../../../Types/proxy-config-editor.types.ts'

export default function useProxyGlobalConfigEditorLogic({
    canEdit,
    onOpenChange,
    open,
}: ProxyGlobalConfigEditorModalProps): ProxyGlobalConfigEditorLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<'edit' | 'active'>('edit')
    const [isResetConfirmationOpen, setResetConfirmationOpen] = useState(false)
    const query = useQuery({
        queryKey: proxyHostManagementQueryKeys.configEditor,
        queryFn: () => getProxyConfigEditorHandler(),
        enabled: open,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const data = query.data
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
    const setSetting = <K extends keyof ProxyHttpSettings>(key: K, value: ProxyHttpSettings[K]) => {
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
            invalidateProxyHostManagementConfigEditorCache(queryClient),
            invalidateProxyHostManagementRuntimeStatusCache(queryClient),
        ])
    }, [queryClient])
    const saveMutation = useMutation({
        mutationFn: (value: ProxyConfigEditorSubmission) =>
            saveProxyConfigEditorHandler({ data: value }),
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
            onOpenChange(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](t(result.message), {
                title: t(
                    'toast.titles.' + (result.runtimeStatus === 'pending' ? 'warning' : 'success'),
                ),
            })
        },
        onError: () => {
            toast.error(t('admin.proxyHosts.config.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })
    const resetMutation = useMutation({
        mutationFn: (value: ProxyConfigEditorSubmission) =>
            resetProxyConfigEditorHandler({ data: { baseRevision: value.baseRevision } }),
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
            onOpenChange(false)
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](t(result.message), {
                title: t(
                    'toast.titles.' + (result.runtimeStatus === 'pending' ? 'warning' : 'success'),
                ),
            })
        },
        onError: () => {
            toast.error(t('admin.proxyHosts.config.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })
    const state: ProxyGlobalConfigEditorState = {
        hasConflict,
        reviewedLatest: reviewedLatest?.settings ?? null,
        isConflictConfirmationOpen,
        activeTab,
        settings,
        baseRevision,
        data,
        isLoading: query.isPending,
        isRefreshing: query.isFetching,
        isSaving: saveMutation.isPending,
        isResetting: resetMutation.isPending,
        isResetConfirmationOpen,
    }
    return {
        state,
        handler: {
            reviewLatest,
            keepDraft,
            useSaved,
            acceptDraft,
            setConflictConfirmationOpen,
            save: () => {
                if (
                    canEdit &&
                    !hasConflict &&
                    !query.isFetching &&
                    baseRevision &&
                    !saveMutation.isPending &&
                    !resetMutation.isPending
                )
                    saveMutation.mutate({ settings, baseRevision })
            },
            reset: () => {
                if (
                    canEdit &&
                    !hasConflict &&
                    !query.isFetching &&
                    baseRevision &&
                    !resetMutation.isPending &&
                    !saveMutation.isPending
                )
                    setResetConfirmationOpen(true)
            },
            confirmReset: async () => {
                if (
                    canEdit &&
                    !hasConflict &&
                    !query.isFetching &&
                    baseRevision &&
                    !resetMutation.isPending &&
                    !saveMutation.isPending
                )
                    await resetMutation
                        .mutateAsync({ settings, baseRevision: baseRevision ?? '' })
                        .catch(() => undefined)
            },
            setResetConfirmationOpen,
            setActiveTab,
            setSetting,
        },
    }
}
