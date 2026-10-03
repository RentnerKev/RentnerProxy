import type { getAuthDatabase } from '../database.server.ts'

export type AuthDatabase = ReturnType<typeof getAuthDatabase>

export type AuthTransaction = Parameters<Parameters<AuthDatabase['transaction']>[0]>[0]
