import type { ProxyGlobalConfigEditorLogicResult } from '../Types/logic.types.ts'
import { invalidateProxyHostManagementConfigEditorCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { invalidateProxyHostManagementRuntimeStatusCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { toast } from '@rentnerkev/toasts/toast'
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

const EMPTY_SETTINGS: ProxyHttpSettings = {}

export default function useProxyGlobalConfigEditorLogic({
    canEdit,
    onOpenChange,
    open,
}: ProxyGlobalConfigEditorModalProps): ProxyGlobalConfigEditorLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<'edit' | 'active'>('edit')
    const [isResetConfirmationOpen, setResetConfirmationOpen] = useState(false)
    const [draft, setDraft] = useState<{
        settings: ProxyHttpSettings
        baseline: ProxyHttpSettings
        baseRevision: string
    } | null>(null)
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
        },
        [baseRevision, canEdit, data, draft, query.isFetching, settings],
    )
    const invalidate = useCallback(async () => {
        await Promise.all([
            invalidateProxyHostManagementConfigEditorCache(queryClient),
            invalidateProxyHostManagementRuntimeStatusCache(queryClient),
        ])
    }, [queryClient])
    const saveMutation = useMutation({
        mutationFn: () =>
            saveProxyConfigEditorHandler({ data: { baseRevision: baseRevision ?? '', settings } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            setDraft(null)
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
        mutationFn: () =>
            resetProxyConfigEditorHandler({ data: { baseRevision: baseRevision ?? '' } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            setDraft(null)
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
            save: () => {
                if (
                    canEdit &&
                    !query.isFetching &&
                    baseRevision &&
                    !saveMutation.isPending &&
                    !resetMutation.isPending
                )
                    saveMutation.mutate()
            },
            reset: () => {
                if (
                    canEdit &&
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
                    !query.isFetching &&
                    baseRevision &&
                    !resetMutation.isPending &&
                    !saveMutation.isPending
                )
                    await resetMutation.mutateAsync().catch(() => undefined)
            },
            setResetConfirmationOpen,
            setActiveTab,
            setSetting,
        },
    }
}
