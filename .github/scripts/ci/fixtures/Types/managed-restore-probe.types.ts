import type { RESTORE_CHECKPOINTS } from '../../online-restore-diagnostics.ts'

export type RestoreCheckpoint = (typeof RESTORE_CHECKPOINTS)[number]

export interface RestoreProgressLock {
    release: () => Promise<void>
    assertHeld: () => void
}
