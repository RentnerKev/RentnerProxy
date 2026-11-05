import { join } from 'node:path'
import { z } from 'zod'
import { managedBackupStateSchema } from '../../../web/src/lib/Backups/validation.ts'
import type { ManagedBackupMaintenance } from '../../../web/src/lib/Backups/Types/backups.types.ts'
import { controlRoot, stateFile, readPrivateJson, writePrivateJson } from './storage.ts'

const proofFile = join(controlRoot, 'restore-restarted.json')
const proofSchema = z.strictObject({
    id: z.uuid(),
    metadataSha256: z.string().regex(/^[a-f0-9]{64}$/u),
})

export function canConfirmRestartedRestore(
    operation: ManagedBackupMaintenance | null | undefined,
): operation is ManagedBackupMaintenance & { metadataSha256: string } {
    return (
        operation?.operation === 'restore' &&
        operation.phase === 'restarting' &&
        operation.progressPercent >= 90 &&
        operation.metadataSha256 !== null &&
        (operation.state === 'failed' || operation.state === 'interrupted')
    )
}

/** Called only by the owned root supervisor after the complete startup readiness check. */
export async function confirmRestartedRestore() {
    const stored = await readPrivateJson(stateFile).catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return null
        throw error
    })
    if (stored === null) return
    const operation = managedBackupStateSchema.parse(stored).maintenance
    if (!canConfirmRestartedRestore(operation)) return
    await writePrivateJson(
        proofFile,
        proofSchema.parse({ id: operation.id, metadataSha256: operation.metadataSha256 }),
    )
}

export async function hasRestartedRestoreProof(operation: ManagedBackupMaintenance) {
    if (!canConfirmRestartedRestore(operation)) return false
    const stored = await readPrivateJson(proofFile, 1024).catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return null
        throw error
    })
    if (stored === null) return false
    const proof = proofSchema.parse(stored)
    return proof.id === operation.id && proof.metadataSha256 === operation.metadataSha256
}
