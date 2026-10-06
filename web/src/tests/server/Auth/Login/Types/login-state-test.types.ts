import type { SQL } from 'drizzle-orm'

export type AuthenticationTestRow = Record<string, unknown>

export interface AuthenticationTestQuery extends Promise<Array<AuthenticationTestRow>> {
    for(mode: string): AuthenticationTestQuery
    innerJoin(table: unknown, condition: SQL): AuthenticationTestQuery
    limit(count: number): AuthenticationTestQuery
    returning(fields: unknown): AuthenticationTestQuery
    where(condition: SQL): AuthenticationTestQuery
}

export interface AuthenticationTestDatabase {
    delete(table: unknown): { where(condition: SQL): AuthenticationTestQuery }
    insert(table: unknown): {
        values(value: AuthenticationTestRow | AuthenticationTestRow[]): {
            returning(fields: unknown): Promise<AuthenticationTestRow[]>
        }
    }
    select(fields?: unknown): { from(table: unknown): AuthenticationTestQuery }
    transaction<T>(callback: (transaction: AuthenticationTestDatabase) => Promise<T>): Promise<T>
    update(table: unknown): {
        set(value: AuthenticationTestRow): { where(condition: SQL): AuthenticationTestQuery }
    }
}

export interface AuthenticationTestFactor extends AuthenticationTestRow {
    id: string
    lastUsedCounter: number
    secretCiphertext: Uint8Array
    secretIv: Uint8Array
    userId: string
}

export interface AuthenticationTestUser extends AuthenticationTestRow {
    email: string
    id: string
    passwordHash: string | null
    status: 'active' | 'disabled'
}
