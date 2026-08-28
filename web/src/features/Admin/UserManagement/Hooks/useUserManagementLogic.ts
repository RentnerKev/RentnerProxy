import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PERMISSIONS } from '../../../../config/permissions.config'
import type { RoleSummary, UserSummary } from '../../../../shared/Types/auth.types'
import { getRolesHandler } from '../../RoleManagement/server'
import { roleManagementQueryKeys } from '../../RoleManagement/queryKeys'
import { userManagementQueryKeys } from '../queryKeys'
import { disableUserHandler, getUsersHandler } from '../server'

const EMPTY_USERS: UserSummary[] = []
const EMPTY_ROLES: RoleSummary[] = []

export default function useUserManagementLogic(permissions: readonly string[]) {
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const [showInvite, setShowInvite] = useState(false)
    const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null)
    const queryClient = useQueryClient()
    const usersQuery = useQuery({
        queryKey: userManagementQueryKeys.all,
        queryFn: () => getUsersHandler(),
    })
    const rolesQuery = useQuery({
        queryKey: roleManagementQueryKeys.all,
        queryFn: () => getRolesHandler(),
    })
    const disableMutation = useMutation({
        mutationFn: (userId: string) => disableUserHandler({ data: { userId } }),
        onSuccess: async (result) => {
            if (result.success) {
                setSelectedUser(null)
                await queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all })
            }
        },
    })
    const openEditor = useCallback((user: UserSummary) => {
        setShowInvite(false)
        setSelectedUser(user)
    }, [])
    const closeEditor = useCallback(() => setSelectedUser(null), [])
    const closeInvite = useCallback(() => setShowInvite(false), [])
    const toggleInvite = useCallback(() => {
        setSelectedUser(null)
        setShowInvite((visible) => !visible)
    }, [])
    const handleDisable = useCallback(
        (user: UserSummary) => {
            if (window.confirm(`Disable ${user.displayName} and revoke all sessions?`)) {
                disableMutation.mutate(user.id)
            }
        },
        [disableMutation],
    )
    const retry = useCallback(() => {
        void Promise.all([usersQuery.refetch(), rolesQuery.refetch()])
    }, [rolesQuery, usersQuery])

    return {
        state: {
            canAssignRoles: permissionSet.has(PERMISSIONS.USERS_ASSIGN_ROLES),
            canCreate: permissionSet.has(PERMISSIONS.USERS_CREATE),
            canDisable: permissionSet.has(PERMISSIONS.USERS_DISABLE),
            canUpdate: permissionSet.has(PERMISSIONS.USERS_UPDATE),
            disableResult: disableMutation.data,
            isDisabling: disableMutation.isPending,
            isError: usersQuery.isError || rolesQuery.isError,
            isPending: usersQuery.isPending || rolesQuery.isPending,
            roles: rolesQuery.data ?? EMPTY_ROLES,
            selectedUser,
            showInvite,
            users: usersQuery.data ?? EMPTY_USERS,
        },
        handler: {
            closeEditor,
            closeInvite,
            handleDisable,
            openEditor,
            retry,
            toggleInvite,
        },
    }
}
