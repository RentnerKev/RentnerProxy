import { redirect } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import type { PermissionKey } from '../../config/permissions.config'
import { getAuthStateHandler, logoutHandler } from './server'
import type { PermissionRouteContext } from './Types/authenticated-route-layout.types'

export function requirePermissionRoute(permission: PermissionKey) {
    return ({ context }: PermissionRouteContext) => {
        if (!context.user.permissions.includes(permission)) {
            throw redirect({ to: '/' })
        }
    }
}

export async function requireSetupRoute() {
    const state = await getAuthStateHandler()

    if (!state.setupRequired) {
        throw redirect({ to: state.user ? '/' : '/login' })
    }

    return state
}

export async function requireAnonymousRoute() {
    const state = await getAuthStateHandler()

    if (state.setupRequired) {
        throw redirect({ to: '/setup' })
    }

    if (state.user) {
        throw redirect({ to: '/' })
    }

    return state
}

export async function requireAuthenticatedRoute() {
    const state = await getAuthStateHandler()

    if (state.setupRequired) {
        throw redirect({ to: '/setup' })
    }

    if (!state.user) {
        throw redirect({ to: '/login' })
    }

    if (!state.user.permissions.includes(PERMISSIONS.APP_ACCESS)) {
        await logoutHandler()
        throw redirect({ to: '/login' })
    }

    return { user: state.user }
}
