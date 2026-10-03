import type { ActionResult } from '../Types/access-policy-management-logic.types.ts'
import {
    invalidateAccessPoliciesCache,
    invalidateAssignableAccessPoliciesCache,
    invalidateAccessPolicyRuntimeStatusCache,
} from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import type { AccessPolicyManagementLogicResult } from '../Types/management-logic.types.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import useLiveInvalidation from '@/shared/Live/Hooks/useLiveInvalidation.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import { accessPolicyManagementQueryKeys } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import {
    applyAccessPolicyConfigurationHandler,
    deleteAccessPolicyHandler,
    getAccessPoliciesHandler,
    getAccessPolicyRuntimeStatusHandler,
} from '../middleware.ts'
import type { AccessPolicyManagementPageProps } from '../Types/access-policy-management.types.ts'

const EMPTY_ACCESS_POLICIES: AccessPolicySummary[] = []

export default function useAccessPolicyManagementLogic({
    permissions,
}: AccessPolicyManagementPageProps): AccessPolicyManagementLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canView = permissionSet.has(PERMISSIONS.ACCESS_POLICIES_VIEW)
    const [showCreate, setShowCreate] = useState(false)
    const [selectedPolicy, setSelectedPolicy] = useState<AccessPolicySummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<AccessPolicySummary | null>(null)
    const [credentialsPolicy, setCredentialsPolicy] = useState<AccessPolicySummary | null>(null)

    const policiesQuery = useQuery({
        queryKey: accessPolicyManagementQueryKeys.all,
        queryFn: () => getAccessPoliciesHandler(),
        enabled: canView,
    })
    const runtimeStatusQuery = useQuery({
        queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
        queryFn: () => getAccessPolicyRuntimeStatusHandler(),
        enabled: canView,
    })
    useLiveInvalidation({
        topic: 'access-policies',
        query: {},
        enabled: canView,
        queryKeys: [
            accessPolicyManagementQueryKeys.all,
            accessPolicyManagementQueryKeys.runtimeStatus,
        ],
    })
    const invalidate = useCallback(async () => {
        await Promise.all([
            invalidateAccessPoliciesCache(queryClient, true),
            invalidateAssignableAccessPoliciesCache(queryClient),
            invalidateAccessPolicyRuntimeStatusCache(queryClient),
        ])
    }, [queryClient])

    const applyMutation = useMutation({
        mutationFn: async (): Promise<ActionResult> =>
            (await applyAccessPolicyConfigurationHandler()) as ActionResult,
        onSuccess: async (result) => {
            await invalidateAccessPolicyRuntimeStatusCache(queryClient)
            if (result.success)
                toast.success(t(result.message), { title: t('toast.titles.success') })
            else toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: () =>
            toast.error(t('admin.accessPolicies.runtime.applyFailed'), {
                title: t('toast.titles.error'),
            }),
    })
    const deleteMutation = useMutation({
        mutationFn: async (policy: AccessPolicySummary): Promise<ActionResult> =>
            (await deleteAccessPolicyHandler({
                data: { accessPolicyId: policy.id },
            })) as ActionResult,
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            if (result.runtimeStatus === 'pending') {
                toast.warning(t('admin.accessPolicies.runtime.savedPending'), {
                    title: t('toast.titles.warning'),
                })
            } else {
                toast.success(t(result.message), { title: t('toast.titles.success') })
            }
            setDeleteTarget(null)
        },
        onError: () =>
            toast.error(t('admin.accessPolicies.errors.deleteFailed'), {
                title: t('toast.titles.error'),
            }),
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
    const openCredentials = useCallback((policy: AccessPolicySummary) => {
        setShowCreate(false)
        setSelectedPolicy(null)
        setDeleteTarget(null)
        setCredentialsPolicy(policy)
    }, [])
    const setCredentialsOpen = useCallback((open: boolean) => {
        if (!open) setCredentialsPolicy(null)
    }, [])
    const handleAccountsChange = useCallback(async () => {
        await invalidateAccessPoliciesCache(queryClient, true)
    }, [queryClient])
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
            canViewCredentials: permissionSet.has(PERMISSIONS.ACCESS_POLICIES_VIEW),
            canUpdate: permissionSet.has(PERMISSIONS.ACCESS_POLICIES_UPDATE),
            credentialsPolicy,
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
            handleAccountsChange,
            openCreate,
            openCredentials,
            openDelete,
            openEditor,
            retry,
            retryRuntime,
            setCreateOpen,
            setDeleteOpen,
            setEditorOpen,
            setCredentialsOpen,
        },
    }
}
