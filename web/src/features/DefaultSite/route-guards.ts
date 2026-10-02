import { PERMISSIONS } from '@/config/permissions.config.ts'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'

export const requireOperationsRoute = requirePermissionRoute(PERMISSIONS.DEFAULT_SITE_VIEW)
