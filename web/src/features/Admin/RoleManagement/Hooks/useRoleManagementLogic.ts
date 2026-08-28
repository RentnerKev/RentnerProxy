import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PERMISSIONS } from '../../../../config/permissions.config'
import type { RoleSummary } from '../../../../shared/Types/auth.types'
import { roleManagementQueryKeys } from '../queryKeys'
import { deleteRoleHandler, getRolesHandler } from '../server'

const EMPTY_ROLES: RoleSummary[] = []

export default function useRoleManagementLogic(permissions: readonly string[]) {
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const [editorOpen, setEditorOpen] = useState(false)
    const [selectedRole, setSelectedRole] = useState<RoleSummary | null>(null)
    const queryClient = useQueryClient()
    const rolesQuery = useQuery({
        queryKey: roleManagementQueryKeys.all,
        queryFn: () => getRolesHandler(),
    })
    const deleteMutation = useMutation({
        mutationFn: (roleId: string) => deleteRoleHandler({ data: { roleId } }),
        onSuccess: async (result) => {
            if (result.success) {
                setSelectedRole(null)
                setEditorOpen(false)
                await queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all })
            }
        },
    })
    const openEditor = useCallback((role: RoleSummary | null) => {
        setSelectedRole(role)
        setEditorOpen(true)
    }, [])
    const closeEditor = useCallback(() => {
        setEditorOpen(false)
        setSelectedRole(null)
    }, [])
    const toggleCreateEditor = useCallback(() => {
        if (editorOpen && !selectedRole) {
            setEditorOpen(false)
            return
        }

        openEditor(null)
    }, [editorOpen, openEditor, selectedRole])
    const handleDelete = useCallback(
        (role: RoleSummary) => {
            if (window.confirm(`Delete the ${role.name} role? Assigned roles cannot be deleted.`)) {
                deleteMutation.mutate(role.id)
            }
        },
        [deleteMutation],
    )
    const retry = useCallback(() => {
        void rolesQuery.refetch()
    }, [rolesQuery])

    return {
        state: {
            canAssignPermissions: permissionSet.has(PERMISSIONS.ROLES_ASSIGN_PERMISSIONS),
            canCreate: permissionSet.has(PERMISSIONS.ROLES_CREATE),
            canDelete: permissionSet.has(PERMISSIONS.ROLES_DELETE),
            canUpdate: permissionSet.has(PERMISSIONS.ROLES_UPDATE),
            deleteResult: deleteMutation.data,
            editorOpen,
            isDeleting: deleteMutation.isPending,
            isError: rolesQuery.isError,
            isPending: rolesQuery.isPending,
            roles: rolesQuery.data ?? EMPTY_ROLES,
            selectedRole,
        },
        handler: {
            closeEditor,
            handleDelete,
            openEditor,
            retry,
            toggleCreateEditor,
        },
    }
}
