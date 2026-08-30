import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'
import { roleManagementQueryKeys } from '../queryKeys'
import { deleteRoleHandler, getRolesHandler } from '../server'
import type { RoleManagementPageProps } from '../Types/role-management-component-props.types'

const EMPTY_ROLES: RoleManagementSummary[] = []

export default function useRoleManagementLogic({ permissions }: RoleManagementPageProps) {
    const toast = useToast()
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
                toast.error(result.message)
                return
            }

            await queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all })
            toast.success(result.message)
            setDeleteTarget(null)
        },
        onError: () => toast.error('admin.roles.errors.deleteFailed'),
    })
    const openCreate = useCallback(() => {
        setSelectedRole(null)
        setShowCreate(true)
    }, [])
    const setCreateOpen = useCallback((open: boolean) => setShowCreate(open), [])
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
        } catch {
            // The mutation callback reports transport failures while keeping the dialog open.
        }
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
            setCreateOpen,
            setDeleteOpen,
            setEditorOpen,
        },
    }
}
