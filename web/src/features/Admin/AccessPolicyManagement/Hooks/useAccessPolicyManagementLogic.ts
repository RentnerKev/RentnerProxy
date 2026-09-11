import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'
import { accessPolicyManagementQueryKeys } from '../queryKeys'
import {
    applyAccessPolicyConfigurationHandler,
    deleteAccessPolicyHandler,
    getAccessPoliciesHandler,
    getAccessPolicyRuntimeStatusHandler,
} from '../server'
import type { AccessPolicyManagementPageProps } from '../Types/access-policy-management.types'

const EMPTY_ACCESS_POLICIES: AccessPolicySummary[] = []

type ActionResult = {
    readonly success: boolean
    readonly message: string
    readonly runtimeStatus?: 'applied' | 'pending'
}

export default function useAccessPolicyManagementLogic({
    permissions,
}: AccessPolicyManagementPageProps) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const [showCreate, setShowCreate] = useState(false)
    const [selectedPolicy, setSelectedPolicy] = useState<AccessPolicySummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<AccessPolicySummary | null>(null)

    const policiesQuery = useQuery({
        queryKey: accessPolicyManagementQueryKeys.all,
        queryFn: () => getAccessPoliciesHandler(),
    })
    const runtimeStatusQuery = useQuery({
        queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
        queryFn: () => getAccessPolicyRuntimeStatusHandler(),
        refetchInterval: 15_000,
        refetchIntervalInBackground: false,
    })
    const invalidate = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.all,
                exact: true,
            }),
            queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.assignable,
            }),
            queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
            }),
        ])
    }, [queryClient])

    const applyMutation = useMutation({
        mutationFn: async (): Promise<ActionResult> =>
            (await applyAccessPolicyConfigurationHandler()) as ActionResult,
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
            })
            if (result.success) toast.success(result.message)
            else toast.error(result.message)
        },
        onError: () => toast.error('admin.accessPolicies.runtime.applyFailed'),
    })
    const deleteMutation = useMutation({
        mutationFn: async (policy: AccessPolicySummary): Promise<ActionResult> =>
            (await deleteAccessPolicyHandler({
                data: { accessPolicyId: policy.id },
            })) as ActionResult,
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }
            await invalidate()
            if (result.runtimeStatus === 'pending') {
                toast.warning('admin.accessPolicies.runtime.savedPending')
            } else {
                toast.success(result.message)
            }
            setDeleteTarget(null)
        },
        onError: () => toast.error('admin.accessPolicies.errors.deleteFailed'),
    })

    const openCreate = useCallback(() => {
        setSelectedPolicy(null)
        setShowCreate(true)
    }, [])
    const setCreateOpen = useCallback((open: boolean) => setShowCreate(open), [])
    const openEditor = useCallback((policy: AccessPolicySummary) => {
        setShowCreate(false)
        setSelectedPolicy(policy)
    }, [])
    const setEditorOpen = useCallback((open: boolean) => {
        if (!open) setSelectedPolicy(null)
    }, [])
    const openDelete = useCallback(
        (policy: AccessPolicySummary) => {
            if (policy.assignedHostCount > 0) return
            deleteMutation.reset()
            setDeleteTarget(policy)
        },
        [deleteMutation],
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
    const confirmDelete = useCallback(async () => {
        if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget).catch(() => undefined)
    }, [deleteMutation, deleteTarget])
    const handleFormSuccess = useCallback(() => {
        setShowCreate(false)
        setSelectedPolicy(null)
    }, [])
    const retry = useCallback(() => {
        void policiesQuery.refetch()
    }, [policiesQuery])
    const retryRuntime = useCallback(() => {
        void runtimeStatusQuery.refetch()
    }, [runtimeStatusQuery])

    return {
        state: {
            canApply: permissionSet.has(PERMISSIONS.ACCESS_POLICIES_APPLY),
            canCreate: permissionSet.has(PERMISSIONS.ACCESS_POLICIES_CREATE),
            canDelete: permissionSet.has(PERMISSIONS.ACCESS_POLICIES_DELETE),
            canUpdate: permissionSet.has(PERMISSIONS.ACCESS_POLICIES_UPDATE),
            deleteTarget,
            isApplying: applyMutation.isPending,
            isDeleting: deleteMutation.isPending,
            isError: policiesQuery.isError,
            isLoading: policiesQuery.isPending,
            isMutating: deleteMutation.isPending,
            policies: policiesQuery.data ?? EMPTY_ACCESS_POLICIES,
            runtimeStatus: runtimeStatusQuery.data,
            runtimeStatusError: runtimeStatusQuery.isError,
            runtimeStatusRetrying: runtimeStatusQuery.isFetching,
            selectedPolicy,
            showCreate,
        },
        handler: {
            apply: () => applyMutation.mutate(),
            confirmDelete,
            handleFormSuccess,
            openCreate,
            openDelete,
            openEditor,
            retry,
            retryRuntime,
            setCreateOpen,
            setDeleteOpen,
            setEditorOpen,
        },
    }
}
