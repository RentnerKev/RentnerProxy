import '@tanstack/react-start/server-only'
import { eq, sql } from 'drizzle-orm'
import { systemSettings } from '@/db/schema.ts'
import {
    assignHostTags,
    emptyHostTagState,
    hostTagStateSchema,
    tagsForHost,
} from '@/lib/HostTags/hostTags.ts'
import type { HostKind, HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

export async function readHostTags(
    transaction: AuthTransaction,
    kind: HostKind,
): Promise<HostTagState> {
    const [row] = await transaction
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, 'host_tags_' + kind + '_v1'))
        .limit(1)
    if (!row) return emptyHostTagState()
    return hostTagStateSchema.parse(
        typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    )
}

// Writers hold the existing runtime lock, including host creation/deletion and discovery reconciliation.
export async function writeHostTags(
    transaction: AuthTransaction,
    kind: HostKind,
    state: HostTagState,
): Promise<void> {
    const value = sql`${hostTagStateSchema.parse(state)}`
    await transaction
        .insert(systemSettings)
        .values({ key: 'host_tags_' + kind + '_v1', value })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: new Date() } })
}

export async function assignHostTagsInTransaction(
    transaction: AuthTransaction,
    kind: HostKind,
    hostId: string,
    tagIds: readonly string[] | undefined,
) {
    const state = await readHostTags(transaction, kind)
    if (tagIds === undefined) return tagsForHost(state, hostId)
    const next = assignHostTags(state, hostId, tagIds)
    if (next !== state) await writeHostTags(transaction, kind, next)
    return tagsForHost(next, hostId)
}
