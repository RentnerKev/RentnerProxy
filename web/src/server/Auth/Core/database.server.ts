import '@tanstack/react-start/server-only'

import { db } from '@/db/index.ts'
import { withCommittedApplicationChanges } from '@/server/WebSockets/committedChanges.ts'

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function wrapTransaction(current: DatabaseTransaction): DatabaseTransaction {
    const wrapped: DatabaseTransaction = new Proxy(current, {
        get(target, property, receiver) {
            if (property !== 'transaction') return Reflect.get(target, property, receiver)
            return <TResult>(operation: (nested: DatabaseTransaction) => Promise<TResult>) =>
                withCommittedApplicationChanges(
                    (run) => target.transaction((nested) => run(wrapTransaction(nested))),
                    operation,
                    wrapped,
                )
        },
    })
    return wrapped
}

function transaction<TResult>(
    operation: (transaction: DatabaseTransaction) => Promise<TResult>,
    options?: Parameters<typeof db.transaction>[1],
): Promise<TResult> {
    return withCommittedApplicationChanges(
        (run) => db.transaction((current) => run(wrapTransaction(current)), options),
        operation,
    )
}

const database = new Proxy(db, {
    get(target, property, receiver) {
        return property === 'transaction' ? transaction : Reflect.get(target, property, receiver)
    },
})

export function getAuthDatabase() {
    return database
}
