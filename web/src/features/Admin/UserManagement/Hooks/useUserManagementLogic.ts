import type { UserManagementLogicResult } from '../Types/management-logic.types.ts'
import { invalidateUserManagementCache } from '@/lib/Admin/UserManagement/userManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { RoleSummary, UserSummary } from '@/lib/Auth/Types/auth.types.ts'
import { roleManagementQueryKeys } from '@/lib/Admin/RoleManagement/roleManagementCache.ts'
import { getRolesHandler } from '@/features/Admin/RoleManagement/middleware.ts'
import { userManagementQueryKeys } from '@/lib/Admin/UserManagement/userManagementCache.ts'
import { disableUserHandler, enableUserHandler, getUsersHandler } from '../middleware.ts'
import type { UserManagementPageProps } from '../Types/user-management-component-props.types.ts'

const EMPTY_USERS: UserSummary[] = []
const EMPTY_ROLES: RoleSummary[] = []

export default function useUserManagementLogic({
    currentUserId,
    currentUserRoleKeys,
    permissions,
}: UserManagementPageProps): UserManagementLogicResult {
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
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            await invalidateUserManagementCache(queryClient)

            if (user.id === currentUserId) {
                await router.invalidate()
            }

            toast.success(t(result.message), { title: t('toast.titles.success') })
            setDisableTarget(null)
        },
        onError: () =>
            toast.error(t('admin.users.errors.disableFailed'), { title: t('toast.titles.error') }),
    })
    const enableMutation = useMutation({
        mutationFn: (user: UserSummary) => enableUserHandler({ data: { userId: user.id } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }

            await invalidateUserManagementCache(queryClient)
            toast.success(t(result.message), { title: t('toast.titles.success') })
        },
        onError: () =>
            toast.error(t('admin.users.errors.enableFailed'), { title: t('toast.titles.error') }),
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
        setSelectedUser(null)
        setShowCreate(true)
    }, [])
    const openEditor = useCallback((user: UserSummary) => {
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
    const confirmDisable = useCallback(async () => {
        if (!disableTarget) {
            return
        }

        try {
            await disableMutation.mutateAsync(disableTarget)
        } catch {}
    }, [disableMutation, disableTarget])
    const enableUser = useCallback(
        (user: UserSummary) => enableMutation.mutate(user),
        [enableMutation],
    )
    const handleFormSuccess = useCallback(() => {
        setShowCreate(false)
        setSelectedUser(null)
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
            canEnable: permissionSet.has(PERMISSIONS.USERS_ENABLE),
            canUpdate: permissionSet.has(PERMISSIONS.USERS_UPDATE),
            disableTarget,
            enablingUserId: enableMutation.isPending
                ? (enableMutation.variables?.id ?? null)
                : null,
            isDisabling: disableMutation.isPending,
            isLoadingUsers: usersQuery.isPending,
            isRolesError: rolesQuery.isError,
            isRolesPending: rolesQuery.isPending && canAssignRoles,
            isUsersError: usersQuery.isError,
            selectedUser,
            showCreate,
            users: usersQuery.data ?? EMPTY_USERS,
        },
        handler: {
            confirmDisable,
            enableUser,
            handleFormSuccess,
            openCreate,
            openDisable,
            openEditor,
            refreshCurrentUser,
            retryRoles,
            retryUsers,
            setCreateOpen: setShowCreate,
            setDisableOpen,
            setEditorOpen,
        },
    }
}
