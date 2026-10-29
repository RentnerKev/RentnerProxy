import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import { publishApplicationChange } from './applicationChanges.ts'

const changedTransactions = new WeakSet<object>()

export function markAuditedApplicationMutation(transaction: object, event: AuditEventInput): void {
    if (
        event.actorKind !== 'user' ||
        !event.actorUserId ||
        event.result !== 'success' ||
        event.resource === 'config-export' ||
        event.action === 'login' ||
        event.action === 'reauthenticate' ||
        event.metadata?.changedFields?.length === 0
    )
        return
    changedTransactions.add(transaction)
}

export async function withCommittedApplicationChanges<TTransaction extends object, TResult>(
    commit: (operation: (transaction: TTransaction) => Promise<TResult>) => Promise<TResult>,
    operation: (transaction: TTransaction) => Promise<TResult>,
    parent?: object,
): Promise<TResult> {
    let current: TTransaction | undefined
    try {
        const result = await commit(async (transaction) => {
            current = transaction
            return operation(transaction)
        })
        if (current && changedTransactions.has(current)) {
            if (parent) changedTransactions.add(parent)
            else publishApplicationChange()
        }
        return result
    } finally {
        if (current) changedTransactions.delete(current)
    }
}
