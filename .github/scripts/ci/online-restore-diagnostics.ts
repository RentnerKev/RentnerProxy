import type { RestoreCheckpoint } from './fixtures/Types/managed-restore-probe.types.ts'

export const RESTORE_CHECKPOINTS = [
    'fixture',
    'management-proxy',
    'seed',
    'backup-connect',
    'backup-start',
    'backup-complete',
    'session-update',
    'restore-connect',
    'restore-start',
    'restore-complete',
    'progress',
    'completion-stream',
    'completion-api',
    'completion-files',
    'interrupted-checkpoint',
    'recovery-fixture',
] as const

const checkpoints: ReadonlySet<string> = new Set(RESTORE_CHECKPOINTS)

export function isOnlineRestoreDiagnostic(line: string): boolean {
    if (line.includes('\n') || line.includes('\r')) return false
    const match =
        /^Managed online restore checkpoint: (.+) category=(?:assertion|timeout|other)$/u.exec(line)
    return match !== null && checkpoints.has(match[1]!)
}

export function onlineRestoreFailureDiagnostic(phase: RestoreCheckpoint, error: unknown): string {
    const category =
        error instanceof Error
            ? error.name === 'AssertionError'
                ? 'assertion'
                : error.name === 'TimeoutError' || error.name === 'AbortError'
                  ? 'timeout'
                  : 'other'
            : 'other'
    const line = `Managed online restore checkpoint: ${phase} category=${category}`
    return isOnlineRestoreDiagnostic(line)
        ? line
        : 'Managed online restore checkpoint: fixture category=other'
}
