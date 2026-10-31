export type MaintenanceProcessOptions = Readonly<{
    cwd: string
    timeoutMs: number
    input?: Uint8Array
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal | undefined
    maximumOutputBytes?: number
    outputFile?: { file: FileHandle; maximumBytes: number }
}>

export type MaintenanceProcessResult = Readonly<{
    exitCode: number | null
    failed: boolean
    timedOut: boolean
    stopped: boolean
    stdout: Uint8Array
    stderr: string
    artifact?: { bytes: number; sha256: string }
}>
import type { FileHandle } from 'node:fs/promises'
