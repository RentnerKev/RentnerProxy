import type { getAuthDatabase } from '../database.server.ts'

type AuthDatabase = ReturnType<typeof getAuthDatabase>

export type AuthTransaction = Parameters<Parameters<AuthDatabase['transaction']>[0]>[0]
