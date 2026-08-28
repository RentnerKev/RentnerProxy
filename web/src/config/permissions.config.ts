export const PERMISSIONS = {
    APP_ACCESS: 'app.access',
    USERS_VIEW: 'users.view',
    USERS_CREATE: 'users.create',
    USERS_UPDATE: 'users.update',
    USERS_DISABLE: 'users.disable',
    USERS_ASSIGN_ROLES: 'users.assign_roles',
    ROLES_VIEW: 'roles.view',
    ROLES_CREATE: 'roles.create',
    ROLES_UPDATE: 'roles.update',
    ROLES_DELETE: 'roles.delete',
    ROLES_ASSIGN_PERMISSIONS: 'roles.assign_permissions',
    ACCOUNT_VIEW: 'account.view',
    ACCOUNT_UPDATE: 'account.update',
} as const

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const PERMISSION_REGISTRY = [
    { key: PERMISSIONS.APP_ACCESS, name: 'Application access' },
    { key: PERMISSIONS.USERS_VIEW, name: 'View users' },
    { key: PERMISSIONS.USERS_CREATE, name: 'Create users' },
    { key: PERMISSIONS.USERS_UPDATE, name: 'Update users' },
    { key: PERMISSIONS.USERS_DISABLE, name: 'Disable users' },
    { key: PERMISSIONS.USERS_ASSIGN_ROLES, name: 'Assign user roles' },
    { key: PERMISSIONS.ROLES_VIEW, name: 'View roles' },
    { key: PERMISSIONS.ROLES_CREATE, name: 'Create roles' },
    { key: PERMISSIONS.ROLES_UPDATE, name: 'Update roles' },
    { key: PERMISSIONS.ROLES_DELETE, name: 'Delete roles' },
    {
        key: PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
        name: 'Assign role permissions',
    },
    { key: PERMISSIONS.ACCOUNT_VIEW, name: 'View own account' },
    { key: PERMISSIONS.ACCOUNT_UPDATE, name: 'Update own account' },
] as const satisfies ReadonlyArray<{ key: PermissionKey; name: string }>

export const SYSTEM_ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    VIEWER: 'viewer',
} as const

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]

const allPermissionKeys = PERMISSION_REGISTRY.map((permission) => permission.key)

export const SYSTEM_ROLE_REGISTRY = [
    {
        key: SYSTEM_ROLES.OWNER,
        name: 'Owner',
        description: 'Built-in role with every registered permission.',
        permissionKeys: allPermissionKeys,
    },
    {
        key: SYSTEM_ROLES.ADMIN,
        name: 'Administrator',
        description: 'Built-in role for user and custom-role administration without owner powers.',
        permissionKeys: [
            PERMISSIONS.APP_ACCESS,
            PERMISSIONS.USERS_VIEW,
            PERMISSIONS.USERS_CREATE,
            PERMISSIONS.USERS_UPDATE,
            PERMISSIONS.USERS_DISABLE,
            PERMISSIONS.USERS_ASSIGN_ROLES,
            PERMISSIONS.ROLES_VIEW,
            PERMISSIONS.ROLES_CREATE,
            PERMISSIONS.ROLES_UPDATE,
            PERMISSIONS.ROLES_DELETE,
            PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
            PERMISSIONS.ACCOUNT_VIEW,
            PERMISSIONS.ACCOUNT_UPDATE,
        ],
    },
    {
        key: SYSTEM_ROLES.VIEWER,
        name: 'Viewer',
        description: 'Built-in role for basic application and account access.',
        permissionKeys: [
            PERMISSIONS.APP_ACCESS,
            PERMISSIONS.ACCOUNT_VIEW,
            PERMISSIONS.ACCOUNT_UPDATE,
        ],
    },
] as const satisfies ReadonlyArray<{
    key: SystemRoleKey
    name: string
    description: string
    permissionKeys: ReadonlyArray<PermissionKey>
}>
