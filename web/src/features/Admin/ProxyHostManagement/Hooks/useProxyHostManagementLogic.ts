import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'
import { proxyHostManagementQueryKeys } from '../queryKeys'
import {
    applyProxyConfigurationHandler,
    deleteProxyHostHandler,
    disableProxyHostHandler,
    enableProxyHostHandler,
    getProxyRuntimeStatusHandler,
    getProxyHostsHandler,
} from '../server'
import type { ProxyHostManagementPageProps } from '../Types/proxy-host-management.types'

const EMPTY_PROXY_HOSTS: ProxyHostSummary[] = []

export default function useProxyHostManagementLogic({ permissions }: ProxyHostManagementPageProps) {
    const toast = useToast()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const [showCreate, setShowCreate] = useState(false)
    const [selectedProxyHost, setSelectedProxyHost] = useState<ProxyHostSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<ProxyHostSummary | null>(null)
    const [disableTarget, setDisableTarget] = useState<ProxyHostSummary | null>(null)
    const queryClient = useQueryClient()
    const proxyHostsQuery = useQuery({
        queryKey: proxyHostManagementQueryKeys.all,
        queryFn: () => getProxyHostsHandler(),
    })
    const runtimeStatusQuery = useQuery({
        queryKey: proxyHostManagementQueryKeys.runtimeStatus,
        queryFn: () => getProxyRuntimeStatusHandler(),
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
    })
    const invalidateProxyHostQueries = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: proxyHostManagementQueryKeys.all,
                exact: true,
            }),
            queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.runtimeStatus }),
        ])
    }, [queryClient])
    const applyMutation = useMutation({
        mutationFn: () => applyProxyConfigurationHandler(),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({
                queryKey: proxyHostManagementQueryKeys.runtimeStatus,
            })
            if (!result.success) {
                toast.error(result.message)
                return
            }

            toast.success(result.message)
        },
        onError: () => toast.error('admin.proxyHosts.runtime.applyFailed'),
    })
    const deleteMutation = useMutation({
        mutationFn: (proxyHost: ProxyHostSummary) =>
            deleteProxyHostHandler({ data: { proxyHostId: proxyHost.id } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            await invalidateProxyHostQueries()
            if (result.runtimeStatus === 'pending') {
                toast.warning('admin.proxyHosts.runtime.savedPending')
            } else {
                toast.success(result.message)
            }
            setDeleteTarget(null)
        },
        onError: () => toast.error('admin.proxyHosts.errors.deleteFailed'),
    })
    const disableMutation = useMutation({
        mutationFn: (proxyHost: ProxyHostSummary) =>
            disableProxyHostHandler({ data: { proxyHostId: proxyHost.id } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            await invalidateProxyHostQueries()
            if (result.runtimeStatus === 'pending') {
                toast.warning('admin.proxyHosts.runtime.savedPending')
            } else {
                toast.success(result.message)
            }
            setDisableTarget(null)
        },
        onError: () => toast.error('admin.proxyHosts.errors.disableFailed'),
    })
    const enableMutation = useMutation({
        mutationFn: (proxyHost: ProxyHostSummary) =>
            enableProxyHostHandler({ data: { proxyHostId: proxyHost.id } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            await invalidateProxyHostQueries()
            if (result.runtimeStatus === 'pending') {
                toast.warning('admin.proxyHosts.runtime.savedPending')
            } else {
                toast.success(result.message)
            }
        },
        onError: () => toast.error('admin.proxyHosts.errors.enableFailed'),
    })
    const openCreate = useCallback(() => {
        setSelectedProxyHost(null)
        setShowCreate(true)
    }, [])
    const setCreateOpen = useCallback((open: boolean) => setShowCreate(open), [])
    const openEditor = useCallback((proxyHost: ProxyHostSummary) => {
        setShowCreate(false)
        setSelectedProxyHost(proxyHost)
    }, [])
    const setEditorOpen = useCallback((open: boolean) => {
        if (!open) setSelectedProxyHost(null)
    }, [])
    const openDelete = useCallback(
        (proxyHost: ProxyHostSummary) => {
            deleteMutation.reset()
            setDeleteTarget(proxyHost)
        },
        [deleteMutation],
    )
    const openDisable = useCallback(
        (proxyHost: ProxyHostSummary) => {
            disableMutation.reset()
            setDisableTarget(proxyHost)
        },
        [disableMutation],
    )
    const setDeleteOpen = useCallback(
        (open: boolean) => {
            if (!open) {
                deleteMutation.reset()
                setDeleteTarget(null)
            }
        },
        [deleteMutation],
    )
    const setDisableOpen = useCallback(
        (open: boolean) => {
            if (!open) {
                disableMutation.reset()
                setDisableTarget(null)
            }
        },
        [disableMutation],
    )
    const confirmDelete = useCallback(async () => {
        if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget).catch(() => undefined)
    }, [deleteMutation, deleteTarget])
    const confirmDisable = useCallback(async () => {
        if (disableTarget) await disableMutation.mutateAsync(disableTarget).catch(() => undefined)
    }, [disableMutation, disableTarget])
    const enable = useCallback(
        (proxyHost: ProxyHostSummary) => {
            enableMutation.mutate(proxyHost)
        },
        [enableMutation],
    )
    const apply = useCallback(() => {
        applyMutation.mutate()
    }, [applyMutation])
    const handleFormSuccess = useCallback(() => {
        setShowCreate(false)
        setSelectedProxyHost(null)
    }, [])
    const retry = useCallback(() => {
        void proxyHostsQuery.refetch()
    }, [proxyHostsQuery])

    return {
        state: {
            canApply: permissionSet.has(PERMISSIONS.PROXY_HOSTS_APPLY),
            canCreate: permissionSet.has(PERMISSIONS.PROXY_HOSTS_CREATE),
            canDelete: permissionSet.has(PERMISSIONS.PROXY_HOSTS_DELETE),
            canDisable: permissionSet.has(PERMISSIONS.PROXY_HOSTS_DISABLE),
            canEnable: permissionSet.has(PERMISSIONS.PROXY_HOSTS_ENABLE),
            canUpdate: permissionSet.has(PERMISSIONS.PROXY_HOSTS_UPDATE),
            deleteTarget,
            disableTarget,
            isDeleting: deleteMutation.isPending,
            isDisabling: disableMutation.isPending,
            isApplying: applyMutation.isPending,
            isMutating:
                deleteMutation.isPending || disableMutation.isPending || enableMutation.isPending,
            isError: proxyHostsQuery.isError,
            isLoading: proxyHostsQuery.isPending,
            proxyHosts: proxyHostsQuery.data ?? EMPTY_PROXY_HOSTS,
            runtimeStatus: runtimeStatusQuery.data,
            selectedProxyHost,
            showCreate,
        },
        handler: {
            apply,
            confirmDelete,
            confirmDisable,
            enable,
            handleFormSuccess,
            openCreate,
            openDelete,
            openDisable,
            openEditor,
            retry,
            setCreateOpen,
            setDeleteOpen,
            setDisableOpen,
            setEditorOpen,
        },
    }
}
