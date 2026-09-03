import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { PERMISSIONS } from '../../../../config/permissions.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { RedirectHostSummary } from '../../../../shared/Types/redirect-hosts.types'
import { redirectHostManagementQueryKeys } from '../queryKeys'
import {
    applyRedirectConfigurationHandler,
    deleteRedirectHostHandler,
    disableRedirectHostHandler,
    enableRedirectHostHandler,
    getRedirectHostsHandler,
    getRedirectRuntimeStatusHandler,
} from '../server'
import type { RedirectHostManagementPageProps } from '../Types/redirect-host-management.types'
const EMPTY_REDIRECT_HOSTS: RedirectHostSummary[] = []
export default function useRedirectHostManagementLogic({
    permissions,
}: RedirectHostManagementPageProps) {
    const toast = useToast()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const queryClient = useQueryClient()
    const [showCreate, setShowCreate] = useState(false)
    const [selected, setSelected] = useState<RedirectHostSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<RedirectHostSummary | null>(null)
    const [disableTarget, setDisableTarget] = useState<RedirectHostSummary | null>(null)
    const hostsQuery = useQuery({
        queryKey: redirectHostManagementQueryKeys.all,
        queryFn: () => getRedirectHostsHandler(),
    })
    const runtimeQuery = useQuery({
        queryKey: redirectHostManagementQueryKeys.runtimeStatus,
        queryFn: () => getRedirectRuntimeStatusHandler(),
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
    })
    const invalidate = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: redirectHostManagementQueryKeys.all,
                exact: true,
            }),
            queryClient.invalidateQueries({
                queryKey: redirectHostManagementQueryKeys.runtimeStatus,
            }),
        ])
    }, [queryClient])
    const applyMutation = useMutation({
        mutationFn: () => applyRedirectConfigurationHandler(),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({
                queryKey: redirectHostManagementQueryKeys.runtimeStatus,
            })
            if (result.success) toast.success(result.message)
            else toast.error(result.message)
        },
        onError: () => toast.error('admin.redirectHosts.runtime.applyFailed'),
    })
    const deleteMutation = useMutation({
        mutationFn: (host: RedirectHostSummary) =>
            deleteRedirectHostHandler({ data: { redirectHostId: host.id } }),
        onSuccess: async (result) => {
            if (!result.success) return toast.error(result.message)
            await invalidate()
            if (result.runtimeStatus === 'pending')
                toast.warning('admin.redirectHosts.runtime.savedPending')
            else toast.success(result.message)
            setDeleteTarget(null)
        },
        onError: () => toast.error('admin.redirectHosts.errors.deleteFailed'),
    })
    const disableMutation = useMutation({
        mutationFn: (host: RedirectHostSummary) =>
            disableRedirectHostHandler({ data: { redirectHostId: host.id } }),
        onSuccess: async (result) => {
            if (!result.success) return toast.error(result.message)
            await invalidate()
            if (result.runtimeStatus === 'pending')
                toast.warning('admin.redirectHosts.runtime.savedPending')
            else toast.success(result.message)
            setDisableTarget(null)
        },
        onError: () => toast.error('admin.redirectHosts.errors.disableFailed'),
    })
    const enableMutation = useMutation({
        mutationFn: (host: RedirectHostSummary) =>
            enableRedirectHostHandler({ data: { redirectHostId: host.id } }),
        onSuccess: async (result) => {
            if (!result.success) return toast.error(result.message)
            await invalidate()
            if (result.runtimeStatus === 'pending')
                toast.warning('admin.redirectHosts.runtime.savedPending')
            else toast.success(result.message)
        },
        onError: () => toast.error('admin.redirectHosts.errors.enableFailed'),
    })
    const openCreate = useCallback(() => {
        setSelected(null)
        setShowCreate(true)
    }, [])
    const openEditor = useCallback((host: RedirectHostSummary) => {
        setShowCreate(false)
        setSelected(host)
    }, [])
    const handleFormSuccess = useCallback(() => {
        setShowCreate(false)
        setSelected(null)
    }, [])
    const retry = useCallback(() => {
        void hostsQuery.refetch()
    }, [hostsQuery])
    const openDelete = useCallback(
        (host: RedirectHostSummary) => {
            deleteMutation.reset()
            setDeleteTarget(host)
        },
        [deleteMutation],
    )
    const openDisable = useCallback(
        (host: RedirectHostSummary) => {
            disableMutation.reset()
            setDisableTarget(host)
        },
        [disableMutation],
    )
    return {
        state: {
            canApply: permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_APPLY),
            canCreate: permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_CREATE),
            canDelete: permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_DELETE),
            canDisable: permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_DISABLE),
            canEnable: permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_ENABLE),
            canUpdate: permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_UPDATE),
            canAssignCertificates:
                permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_CREATE) ||
                permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_UPDATE),
            deleteTarget,
            disableTarget,
            isDeleting: deleteMutation.isPending,
            isDisabling: disableMutation.isPending,
            isApplying: applyMutation.isPending,
            isMutating:
                deleteMutation.isPending || disableMutation.isPending || enableMutation.isPending,
            isError: hostsQuery.isError,
            isLoading: hostsQuery.isPending,
            redirectHosts: hostsQuery.data ?? EMPTY_REDIRECT_HOSTS,
            runtimeStatus: runtimeQuery.data,
            selected,
            showCreate,
        },
        handler: {
            apply: () => applyMutation.mutate(),
            confirmDelete: async () => {
                if (deleteTarget)
                    await deleteMutation.mutateAsync(deleteTarget).catch(() => undefined)
            },
            confirmDisable: async () => {
                if (disableTarget)
                    await disableMutation.mutateAsync(disableTarget).catch(() => undefined)
            },
            enable: (host: RedirectHostSummary) => enableMutation.mutate(host),
            handleFormSuccess,
            openCreate,
            openDelete,
            openDisable,
            openEditor,
            retry,
            setCreateOpen: setShowCreate,
            setDeleteOpen: (open: boolean) => {
                if (!open) {
                    deleteMutation.reset()
                    setDeleteTarget(null)
                }
            },
            setDisableOpen: (open: boolean) => {
                if (!open) {
                    disableMutation.reset()
                    setDisableTarget(null)
                }
            },
            setEditorOpen: (open: boolean) => {
                if (!open) setSelected(null)
            },
        },
    }
}
