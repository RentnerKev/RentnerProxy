import '@tanstack/react-start/server-only'

import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { z } from 'zod'

import { managedBackupMaintenanceSchema } from '@/lib/Backups/validation.ts'
import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'

export async function readRestoreMaintenanceStatus(): Promise<ManagedBackupMaintenance | null> {
    let file
    try {
        file = await open(
            '/run/rentnerproxy/maintenance/progress.json',
            constants.O_RDONLY | constants.O_NOFOLLOW,
        )
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return null
        throw error
    }
    try {
        const info = await file.stat()
        if (
            !info.isFile() ||
            info.nlink !== 1 ||
            info.uid !== 0 ||
            info.size > 16_384 ||
            (info.mode & 0o022) !== 0
        )
            throw new Error('Invalid restore maintenance status file')
        const bytes = Buffer.alloc(16_385)
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 16_384) throw new Error('Restore maintenance status is too large')
        return z
            .strictObject({ maintenance: managedBackupMaintenanceSchema.nullable() })
            .parse(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))).maintenance
    } finally {
        await file.close()
    }
}
