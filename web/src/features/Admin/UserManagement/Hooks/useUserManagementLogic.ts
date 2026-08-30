import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS, SYSTEM_ROLES } from '../../../../config/permissions.config'
import type { RoleSummary, UserSummary } from '../../../../shared/Types/auth.types'
import { roleManagementQueryKeys } from '../../RoleManagement/queryKeys'
import { getRolesHandler } from '../../RoleManagement/server'
import { userManagementQueryKeys } from '../queryKeys'
import { disableUserHandler, getUsersHandler } from '../server'
import type { UserManagementPageProps } from '../Types/user-management-component-props.types'
import useTranslationStore from '../../../../language/useTranslationStore'

const EMPTY_USERS: UserSummary[] = []
const EMPTY_ROLES: RoleSummary[] = []

export default function useUserManagementLogic({
    currentUserId,
    currentUserRoleKeys,
    permissions,
}: UserManagementPageProps) {
    const { t } = useTranslationStore()
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const actorIsOwner = currentUserRoleKeys.includes(SYSTEM_ROLES.OWNER)
    const canAssignRoles =
        permissionSet.has(PERMISSIONS.USERS_ASSIGN_ROLES) &&
        permissionSet.has(PERMISSIONS.ROLES_VIEW)
    const canCreate = permissionSet.has(PERMISSIONS.USERS_CREATE) && canAssignRoles
    const [showCreate, setShowCreate] = useState(false)
    const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null)
    const [disableTarget, setDisableTarget] = useState<UserSummary | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)
    const queryClient = useQueryClient()
    const router = useRouter()
    const usersQuery = useQuery({
        queryKey: userManagementQueryKeys.all,
        queryFn: () => getUsersHandler(),
    })
    const rolesQuery = useQuery({
        queryKey: roleManagementQueryKeys.all,
        queryFn: () => getRolesHandler(),
        enabled: canAssignRoles,
    })
    const disableMutation = useMutation({
        mutationFn: (user: UserSummary) => disableUserHandler({ data: { userId: user.id } }),
        onSuccess: async (result, user) => {
            if (!result.success) {
                return
            }

            await queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all })

            if (user.id === currentUserId) {
                await router.invalidate()
            }

            setSuccessMessage(result.message)
            setDisableTarget(null)
        },
    })
    const assignableRoles = useMemo(() => {
        if (!canAssignRoles) {
            return EMPTY_ROLES
        }

        return (rolesQuery.data ?? EMPTY_ROLES).filter((role) => {
            if (role.key === SYSTEM_ROLES.OWNER && !actorIsOwner) {
                return false
            }

            return (
                actorIsOwner ||
                role.permissionKeys.every((permission) => permissionSet.has(permission))
            )
        })
    }, [actorIsOwner, canAssignRoles, permissionSet, rolesQuery.data])
    const openCreate = useCallback(() => {
        setSuccessMessage(null)
        setSelectedUser(null)
        setShowCreate(true)
    }, [])
    const setCreateOpen = useCallback((open: boolean) => setShowCreate(open), [])
    const openEditor = useCallback((user: UserSummary) => {
        setSuccessMessage(null)
        setShowCreate(false)
        setSelectedUser(user)
    }, [])
    const setEditorOpen = useCallback((open: boolean) => {
        if (!open) {
            setSelectedUser(null)
        }
    }, [])
    const openDisable = useCallback(
        (user: UserSummary) => {
            disableMutation.reset()
            setSuccessMessage(null)
            setDisableTarget(user)
        },
        [disableMutation],
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
    const confirmDisable = useCallback(() => {
        if (disableTarget) {
            disableMutation.mutate(disableTarget)
        }
    }, [disableMutation, disableTarget])
    const handleFormSuccess = useCallback((message: string) => {
        setShowCreate(false)
        setSelectedUser(null)
        setSuccessMessage(message)
    }, [])
    const retryUsers = useCallback(() => {
        void usersQuery.refetch()
    }, [usersQuery])
    const retryRoles = useCallback(() => {
        void rolesQuery.refetch()
    }, [rolesQuery])
    const refreshCurrentUser = useCallback(() => router.invalidate(), [router])

    return {
        state: {
            actorIsOwner,
            assignableRoles,
            canAssignRoles: canAssignRoles && !rolesQuery.isError,
            canCreate,
            canDisable: permissionSet.has(PERMISSIONS.USERS_DISABLE),
            canUpdate: permissionSet.has(PERMISSIONS.USERS_UPDATE),
            disableError:
                disableMutation.data && !disableMutation.data.success
                    ? disableMutation.data.message
                    : disableMutation.isError
                      ? t('admin.users.errors.disableFailed')
                      : null,
            disableTarget,
            isDisabling: disableMutation.isPending,
            isLoadingUsers: usersQuery.isPending,
            isRolesError: rolesQuery.isError,
            isRolesPending: rolesQuery.isPending && canAssignRoles,
            isUsersError: usersQuery.isError,
            selectedUser,
            showCreate,
            successMessage,
            users: usersQuery.data ?? EMPTY_USERS,
        },
        handler: {
            confirmDisable,
            handleFormSuccess,
            openCreate,
            openDisable,
            openEditor,
            refreshCurrentUser,
            retryRoles,
            retryUsers,
            setCreateOpen,
            setDisableOpen,
            setEditorOpen,
        },
    }
}
