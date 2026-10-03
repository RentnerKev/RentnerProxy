import '@tanstack/react-start/server-only'

import { users } from '@/db/schema.ts'
import type { AuthState } from '@/server/Auth/Core/Types/auth-service.types.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getCurrentSessionService } from './sessions.service.ts'

async function hasAnyUserService(): Promise<boolean> {
    const rows = await getAuthDatabase().select({ id: users.id }).from(users).limit(1)
    return rows.length > 0
}

export async function getAuthStateService(): Promise<AuthState> {
    if (!(await hasAnyUserService())) {
        return { setupRequired: true, session: null, user: null }
    }

    const session = await getCurrentSessionService()
    return {
        setupRequired: false,
        session,
        user: session?.user ?? null,
    }
}
