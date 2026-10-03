import type { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES]
