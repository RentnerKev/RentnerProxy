import type { SQL } from 'drizzle-orm'

interface PasskeyTestQuery {
    innerJoin(): PasskeyTestQuery
    where(): PasskeyTestQuery
    limit(): Promise<unknown[]>
}

export interface PasskeyTestDatabase {
    select(): { from(): PasskeyTestQuery }
    update(): {
        set(values: Record<string, unknown>): {
            where(condition: SQL): { returning(): Promise<{ id: string }[]> }
        }
    }
    transaction<T>(callback: (transaction: PasskeyTestDatabase) => Promise<T>): Promise<T>
}
