import '@tanstack/react-start/server-only'

import { db } from '../../../db'

export function getAuthDatabase() {
    return db
}

export type AuthDatabase = ReturnType<typeof getAuthDatabase>
export type AuthTransaction = Parameters<Parameters<AuthDatabase['transaction']>[0]>[0]
