import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS } from '../../../../config/permissions.config'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'
import { roleManagementQueryKeys } from '../queryKeys'
import { deleteRoleHandler, getRolesHandler } from '../server'
import type { RoleManagementPageProps } from '../Types/role-management-component-props.types'

const EMPTY_ROLES: RoleManagementSummary[] = []

export default function useRoleManagementLogic({ permissions }: RoleManagementPageProps) {
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canAssignPermissions = permissionSet.has(PERMISSIONS.ROLES_ASSIGN_PERMISSIONS)
    const [showCreate, setShowCreate] = useState(false)
    const [selectedRole, setSelectedRole] = useState<RoleManagementSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<RoleManagementSummary | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)
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
                return
            }

            await queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all })
            setSuccessMessage(result.message)
            setDeleteTarget(null)
        },
    })
    const openCreate = useCallback(() => {
        setSuccessMessage(null)
        setSelectedRole(null)
        setShowCreate(true)
    }, [])
    const setCreateOpen = useCallback((open: boolean) => setShowCreate(open), [])
    const openEditor = useCallback((role: RoleManagementSummary) => {
        setSuccessMessage(null)
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
            setSuccessMessage(null)
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
    const confirmDelete = useCallback(() => {
        if (deleteTarget) {
            deleteMutation.mutate(deleteTarget)
        }
    }, [deleteMutation, deleteTarget])
    const handleFormSuccess = useCallback((message: string) => {
        setShowCreate(false)
        setSelectedRole(null)
        setSuccessMessage(message)
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
            deleteError:
                deleteMutation.data && !deleteMutation.data.success
                    ? deleteMutation.data.message
                    : deleteMutation.isError
                      ? 'The role could not be deleted.'
                      : null,
            deleteTarget,
            isDeleting: deleteMutation.isPending,
            isError: rolesQuery.isError,
            isLoading: rolesQuery.isPending,
            roles: rolesQuery.data ?? EMPTY_ROLES,
            selectedRole,
            showCreate,
            successMessage,
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
