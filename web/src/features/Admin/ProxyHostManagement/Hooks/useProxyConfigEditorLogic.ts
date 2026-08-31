import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import type {
    ProxyConfigSource,
    ProxyHostConfigEditorData,
} from '../../../../shared/Types/proxy-runtime.types'
import { proxyAdvancedConfigSchema, ProxyHttpSettingsParseError } from '../config-validation'
import {
    composeProxyHostConfig,
    extractProxyHostSettings,
    ManagedHostConfigError,
    MAX_HOST_CONFIG_SOURCE_LENGTH,
} from '../Helpers/nginxConfigSource'
import {
    getProxyHostConfigEditorHandler,
    previewProxyHostConfigEditorHandler,
    resetProxyHostConfigEditorHandler,
    saveProxyHostConfigEditorHandler,
} from '../server'
import { proxyHostManagementQueryKeys } from '../queryKeys'
import type {
    ProxyConfigEditorDraft,
    ProxyConfigEditorHandlers,
    ProxyConfigEditorLogic,
    ProxyConfigEditorLogicProps,
    ProxyConfigEditorState,
    ProxyConfigEditorTab,
} from '../Types/proxy-config-editor.types'

const CONFIG_ERROR_PREFIX = 'admin.proxyHosts.config.errors.'
const SAVE_ERROR = `${CONFIG_ERROR_PREFIX}saveFailed`
const PREVIEW_ERROR = `${CONFIG_ERROR_PREFIX}previewFailed`
const INVALID_SETTINGS_ERROR = `${CONFIG_ERROR_PREFIX}invalidSettings`
const INVALID_ADVANCED_ERROR = `${CONFIG_ERROR_PREFIX}invalidAdvancedConfig`

type HostConfigEditorData = ProxyHostConfigEditorData
type HostConfigSaveValues = {
    readonly baseRevision: string
    readonly settingsSource: string
    readonly advancedConfig?: string
}
type HostConfigResetValues = {
    readonly baseRevision: string
    readonly resetAdvancedConfig?: boolean
}
type HostConfigPreviewValues = {
    readonly settingsSource: string
    readonly advancedConfig?: string
}

function safeConfigErrorKey(message: string, fallback: string): string {
    return message.startsWith(CONFIG_ERROR_PREFIX) ? message : fallback
}

function getAdvancedValidationError(source: string): string | null {
    const result = proxyAdvancedConfigSchema.safeParse(source)
    if (result.success) return null

    const message = result.error.issues[0]?.message
    return typeof message === 'string'
        ? safeConfigErrorKey(message, INVALID_ADVANCED_ERROR)
        : INVALID_ADVANCED_ERROR
}

export default function useProxyConfigEditorLogic({
    canAdvancedConfig = false,
    canEdit,
    onOpenChange,
    open,
    proxyHost,
}: ProxyConfigEditorLogicProps): ProxyConfigEditorLogic {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState<ProxyConfigEditorTab>('edit')
    const configQueryKey = proxyHostManagementQueryKeys.hostConfigEditor(
        proxyHost.id,
        canAdvancedConfig,
    )
    const [draftState, setDraftState] = useState<ProxyConfigEditorDraft | null>(null)
    const [preview, setPreview] = useState<ProxyConfigSource | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [actionErrorLine, setActionErrorLine] = useState<number | null>(null)
    const [previewError, setPreviewError] = useState<string | null>(null)
    const [previewErrorLine, setPreviewErrorLine] = useState<number | null>(null)
    const [isResetConfirmationOpen, setResetConfirmationOpen] = useState(false)
    const [isReloadConfirmationOpen, setReloadConfirmationOpen] = useState(false)

    const configQuery = useQuery({
        queryKey: configQueryKey,
        queryFn: () => getProxyHostConfigEditorHandler({ data: { proxyHostId: proxyHost.id } }),
        enabled: open,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
    })

    const data = configQuery.data as HostConfigEditorData | undefined
    const currentTemplate = data?.defaults?.config ?? null
    const template = draftState ? draftState.template : currentTemplate
    const savedSource = composeProxyHostConfig(currentTemplate, data?.settingsSource ?? '')
    const savedAdvancedConfig = typeof data?.advancedConfig === 'string' ? data.advancedConfig : ''
    const advancedAvailable = canAdvancedConfig && typeof data?.advancedConfig === 'string'
    const draft = draftState?.source ?? savedSource
    const advancedConfig = draftState?.advancedConfig ?? savedAdvancedConfig
    const baseRevision = draftState?.baseRevision ?? data?.baseRevision ?? null
    const isDirty =
        draftState !== null &&
        (draftState.source !== draftState.baseline ||
            draftState.advancedConfig !== draftState.advancedBaseline)

    const resetDraft = useCallback(() => {
        setDraftState(null)
        setActiveTab('edit')
        setPreview(null)
        setActionError(null)
        setActionErrorLine(null)
        setPreviewError(null)
        setPreviewErrorLine(null)
    }, [])

    const clearActionError = useCallback(() => {
        setActionError(null)
        setActionErrorLine(null)
        setPreviewError(null)
        setPreviewErrorLine(null)
    }, [])

    const setDraft = useCallback(
        (value: string) => {
            if (!canEdit || baseRevision === null || !data) return
            setDraftState({
                advancedConfig: draftState?.advancedConfig ?? savedAdvancedConfig,
                advancedBaseline: draftState?.advancedBaseline ?? savedAdvancedConfig,
                baseline: draftState?.baseline ?? savedSource,
                source: value.slice(0, MAX_HOST_CONFIG_SOURCE_LENGTH),
                template,
                baseRevision,
            })
            setPreview(null)
            clearActionError()
        },
        [
            baseRevision,
            canEdit,
            clearActionError,
            data,
            draftState,
            savedAdvancedConfig,
            savedSource,
            template,
        ],
    )

    const setAdvancedConfig = useCallback(
        (value: string) => {
            if (!canEdit || !advancedAvailable || baseRevision === null || !data) return
            setDraftState({
                advancedConfig: value,
                advancedBaseline: draftState?.advancedBaseline ?? savedAdvancedConfig,
                baseline: draftState?.baseline ?? savedSource,
                source: draftState?.source ?? savedSource,
                template,
                baseRevision,
            })
            setPreview(null)
            clearActionError()
        },
        [
            advancedAvailable,
            baseRevision,
            canEdit,
            clearActionError,
            data,
            draftState,
            savedAdvancedConfig,
            savedSource,
            template,
        ],
    )

    const saveMutation = useMutation({
        mutationFn: (values: HostConfigSaveValues) =>
            saveProxyHostConfigEditorHandler({
                data: { ...values, proxyHostId: proxyHost.id },
            }),
        onSuccess: async (result) => {
            if (!result.success) {
                const message = safeConfigErrorKey(result.message, SAVE_ERROR)
                setActionError(message)
                setActionErrorLine(null)
                toast.error(result.message)
                return
            }

            await queryClient.invalidateQueries({ queryKey: configQueryKey })
            await queryClient.invalidateQueries({
                queryKey: proxyHostManagementQueryKeys.runtimeStatus,
            })
            const latest = queryClient.getQueryData<HostConfigEditorData>(configQueryKey)
            if (latest) resetDraft()

            if (result.runtimeStatus === 'pending') {
                toast.warning(result.message)
            } else {
                toast.success(result.message)
            }
            onOpenChange(false)
        },
        onError: () => {
            setActionError(SAVE_ERROR)
            setActionErrorLine(null)
            toast.error(SAVE_ERROR)
        },
    })

    const previewMutation = useMutation({
        mutationFn: (values: HostConfigPreviewValues) =>
            previewProxyHostConfigEditorHandler({
                data: { ...values, proxyHostId: proxyHost.id },
            }),
        onSuccess: (result) => {
            setPreview(result)
            setActiveTab('preview')
            setPreviewError(null)
            setPreviewErrorLine(null)
        },
        onError: () => {
            setPreview(null)
            setPreviewError(PREVIEW_ERROR)
            setPreviewErrorLine(null)
        },
    })

    const resetMutation = useMutation({
        mutationFn: (values: HostConfigResetValues) =>
            resetProxyHostConfigEditorHandler({
                data: { ...values, proxyHostId: proxyHost.id },
            }),
        onSuccess: async (result) => {
            if (!result.success) {
                const message = safeConfigErrorKey(result.message, SAVE_ERROR)
                setActionError(message)
                setActionErrorLine(null)
                toast.error(result.message)
                return
            }

            await queryClient.invalidateQueries({ queryKey: configQueryKey })
            await queryClient.invalidateQueries({
                queryKey: proxyHostManagementQueryKeys.runtimeStatus,
            })
            const latest = queryClient.getQueryData<HostConfigEditorData>(configQueryKey)
            if (latest) resetDraft()

            if (result.runtimeStatus === 'pending') {
                toast.warning(result.message)
            } else {
                toast.success(result.message)
            }
            setResetConfirmationOpen(false)
            onOpenChange(false)
        },
        onError: () => {
            setActionError(SAVE_ERROR)
            setActionErrorLine(null)
            toast.error(SAVE_ERROR)
        },
    })

    const getSaveValues = useCallback((): HostConfigSaveValues | null => {
        if (!advancedAvailable) {
            return { baseRevision: baseRevision ?? '', settingsSource: '' }
        }
        const advancedError = getAdvancedValidationError(advancedConfig)
        if (advancedError) {
            setActionError(advancedError)
            setActionErrorLine(null)
            return null
        }
        return {
            advancedConfig,
            baseRevision: baseRevision ?? '',
            settingsSource: '',
        }
    }, [advancedAvailable, advancedConfig, baseRevision])

    const previewSettings = useCallback(() => {
        if (
            !canEdit ||
            baseRevision === null ||
            previewMutation.isPending ||
            saveMutation.isPending
        ) {
            return
        }

        clearActionError()
        let settingsSource: string
        try {
            settingsSource = extractProxyHostSettings(draft, template)
        } catch (error) {
            setPreview(null)
            if (error instanceof ProxyHttpSettingsParseError) {
                setPreviewError(INVALID_SETTINGS_ERROR)
                setPreviewErrorLine(error.line)
            } else {
                setPreviewError(
                    error instanceof ManagedHostConfigError
                        ? `${CONFIG_ERROR_PREFIX}managedConfig`
                        : PREVIEW_ERROR,
                )
                setPreviewErrorLine(null)
            }
            return
        }

        const values = getSaveValues()
        if (!values) {
            setPreviewError(INVALID_ADVANCED_ERROR)
            return
        }
        const previewValues = advancedAvailable
            ? { advancedConfig, settingsSource }
            : { settingsSource }
        previewMutation.mutate(previewValues)
    }, [
        advancedAvailable,
        advancedConfig,
        baseRevision,
        canEdit,
        clearActionError,
        draft,
        getSaveValues,
        previewMutation,
        saveMutation,
        template,
    ])

    const save = useCallback(() => {
        if (
            !canEdit ||
            baseRevision === null ||
            saveMutation.isPending ||
            resetMutation.isPending
        ) {
            return
        }

        clearActionError()
        let settingsSource: string
        try {
            settingsSource = extractProxyHostSettings(draft, template)
        } catch (error) {
            if (error instanceof ProxyHttpSettingsParseError) {
                setActionError(INVALID_SETTINGS_ERROR)
                setActionErrorLine(error.line)
            } else {
                setActionError(
                    error instanceof ManagedHostConfigError
                        ? `${CONFIG_ERROR_PREFIX}managedConfig`
                        : INVALID_SETTINGS_ERROR,
                )
                setActionErrorLine(null)
            }
            return
        }

        const values = getSaveValues()
        if (!values) return
        saveMutation.mutate({ ...values, settingsSource })
    }, [
        baseRevision,
        canEdit,
        clearActionError,
        draft,
        getSaveValues,
        resetMutation,
        saveMutation,
        template,
    ])

    const reset = useCallback(() => {
        if (
            !canEdit ||
            baseRevision === null ||
            saveMutation.isPending ||
            resetMutation.isPending
        ) {
            return
        }

        clearActionError()
        setResetConfirmationOpen(true)
    }, [baseRevision, canEdit, clearActionError, resetMutation, saveMutation])

    const confirmReset = useCallback(async () => {
        if (baseRevision === null || resetMutation.isPending) return
        await resetMutation
            .mutateAsync({
                baseRevision,
                ...(advancedAvailable ? { resetAdvancedConfig: true } : {}),
            })
            .catch(() => undefined)
    }, [advancedAvailable, baseRevision, resetMutation])

    const reloadSavedConfiguration = useCallback(async () => {
        const result = await configQuery.refetch()
        if (result.isError || !result.data) {
            toast.error(`${CONFIG_ERROR_PREFIX}loadFailed`)
            return
        }
        resetDraft()
        setReloadConfirmationOpen(false)
    }, [configQuery, resetDraft, toast])

    const refresh = useCallback(() => {
        if (isDirty) {
            setReloadConfirmationOpen(true)
        } else {
            void reloadSavedConfiguration()
        }
    }, [isDirty, reloadSavedConfiguration])

    const state: ProxyConfigEditorState = {
        actionError,
        actionErrorLine,
        activeTab,
        advancedAvailable,
        advancedConfig,
        baseRevision,
        data,
        isError: configQuery.isError,
        isLoading: configQuery.isPending,
        isPreviewing: previewMutation.isPending,
        isRefreshing: configQuery.isFetching,
        isReloadConfirmationOpen,
        isResetConfirmationOpen,
        isResetting: resetMutation.isPending,
        isSaving: saveMutation.isPending,
        preview,
        previewError,
        previewErrorLine,
        templateAvailable: template !== null,
        draft,
    }
    const handler: ProxyConfigEditorHandlers = {
        confirmReload: reloadSavedConfiguration,
        confirmReset,
        preview: previewSettings,
        refresh,
        reset,
        save,
        setActiveTab,
        setAdvancedConfig,
        setDraft,
        setReloadConfirmationOpen,
        setResetConfirmationOpen,
    }

    return { handler, state }
}
