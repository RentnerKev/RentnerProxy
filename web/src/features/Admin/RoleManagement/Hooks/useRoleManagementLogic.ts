import type { RoleManagementLogicResult } from '../Types/management-logic.types.ts'
import { invalidateRoleManagementCache } from '@/lib/Admin/RoleManagement/roleManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { RoleManagementSummary } from '@/lib/Auth/Types/auth.types.ts'
import { roleManagementQueryKeys } from '@/lib/Admin/RoleManagement/roleManagementCache.ts'
import { deleteRoleHandler, getRolesHandler } from '../middleware.ts'
import type { RoleManagementPageProps } from '../Types/role-management-component-props.types.ts'

const EMPTY_ROLES: RoleManagementSummary[] = []

export default function useRoleManagementLogic({
    permissions,
}: RoleManagementPageProps): RoleManagementLogicResult {
    const { t } = useTranslationStore()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canAssignPermissions = permissionSet.has(PERMISSIONS.ROLES_ASSIGN_PERMISSIONS)
    const [showCreate, setShowCreate] = useState(false)
    const [selectedRole, setSelectedRole] = useState<RoleManagementSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<RoleManagementSummary | null>(null)

    const queryClient = useQueryClient()
    const router = useRouter()
    const rolesQuery = useQuery({
        queryKey: roleManagementQueryKeys.all,
        queryFn: () => getRolesHandler(),
    })
    const deleteMutation = useMutation({
        mutationFn: (role: RoleManagementSummary) =>
            deleteRoleHandler({ data: { roleId: role.id } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            await invalidateRoleManagementCache(queryClient)
            toast.success(t(result.message), { title: t('toast.titles.success') })
            setDeleteTarget(null)
        },
        onError: () =>
            toast.error(t('admin.roles.errors.deleteFailed'), { title: t('toast.titles.error') }),
    })
    const openCreate = useCallback(() => {
        setSelectedRole(null)
        setShowCreate(true)
    }, [])
    const openEditor = useCallback((role: RoleManagementSummary) => {
        setShowCreate(false)
        setSelectedRole(role)
    }, [])
    const setEditorOpen = useCallback((open: boolean) => {
        if (!open) {
            setSelectedRole(null)
        }
    }, [])
    const openDelete = useCallback(
        (role: RoleManagementSummary) => {
            if (role.isSystem || role.userCount > 0) {
                return
            }

            deleteMutation.reset()
            setDeleteTarget(role)
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
        if (!deleteTarget) {
            return
        }

        try {
            await deleteMutation.mutateAsync(deleteTarget)
        } catch {}
    }, [deleteMutation, deleteTarget])
    const handleFormSuccess = useCallback(() => {
        setShowCreate(false)
        setSelectedRole(null)
    }, [])
    const retry = useCallback(() => {
        void rolesQuery.refetch()
    }, [rolesQuery])
    const refreshCurrentUser = useCallback(() => router.invalidate(), [router])

    return {
        state: {
            assignablePermissionKeys: permissions,
            canAssignPermissions,
            canCreate: permissionSet.has(PERMISSIONS.ROLES_CREATE) && canAssignPermissions,
            canDelete: permissionSet.has(PERMISSIONS.ROLES_DELETE),
            canUpdate: permissionSet.has(PERMISSIONS.ROLES_UPDATE),
            deleteTarget,
            isDeleting: deleteMutation.isPending,
            isError: rolesQuery.isError,
            isLoading: rolesQuery.isPending,
            roles: rolesQuery.data ?? EMPTY_ROLES,
            selectedRole,
            showCreate,
        },
        handler: {
            confirmDelete,
            handleFormSuccess,
            openCreate,
            openDelete,
            openEditor,
            refreshCurrentUser,
            retry,
            setCreateOpen: setShowCreate,
            setDeleteOpen,
            setEditorOpen,
        },
    }
}
