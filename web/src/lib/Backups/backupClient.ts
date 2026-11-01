import { z } from 'zod'
import { BACKUP_UI_POLICY } from '@/config/backups.config.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import {
    managedBackupConfigurationUpdateSchema,
    managedBackupStartSchema,
    managedBackupStatusSchema,
} from './validation.ts'
import type {
    BackupClientErrorCode,
    BackupConfigurationInput,
    BackupStartInput,
} from './Types/backups-client.types.ts'

const startInput = managedBackupStartSchema.omit({ actorId: true })
const configurationInput = managedBackupConfigurationUpdateSchema.omit({ actorId: true })
const failureSchema = z.strictObject({
    error: z.enum([
        'authentication_required',
        'permission_denied',
        'invalid_input',
        'busy',
        'revision_conflict',
        'capacity',
        'rate_limited',
        'unavailable',
    ]),
})

export class BackupClientError extends Error {
    constructor(readonly code: BackupClientErrorCode) {
        super(code)
    }
}

async function request(
    operation: 'status' | 'start' | 'config',
    signal?: AbortSignal,
    input?: BackupStartInput | BackupConfigurationInput,
) {
    const deadline = AbortSignal.timeout(BACKUP_UI_POLICY.requestTimeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
        combined.throwIfAborted()
        const response = await fetch('/api/admin/backups/' + operation, {
            method: input === undefined ? 'GET' : 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            signal: combined,
            headers: {
                accept: 'application/json',
                ...(input === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        })
        if (!response.ok && (response.status === 401 || response.status === 403)) {
            void response.body?.cancel().catch(() => {})
            throw new BackupClientError(
                response.status === 401 ? 'authentication_required' : 'permission_denied',
            )
        }
        if (
            !response.body ||
            response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
                'application/json'
        ) {
            void response.body?.cancel().catch(() => {})
            throw new BackupClientError('invalid_response')
        }
        const bytes = await readBoundedStream(
            response.body,
            BACKUP_UI_POLICY.responseLimitBytes,
            combined,
        )
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        if (!response.ok) {
            const failure = failureSchema.safeParse(value)
            throw new BackupClientError(failure.success ? failure.data.error : 'unavailable')
        }
        combined.throwIfAborted()
        const status = managedBackupStatusSchema.safeParse(value)
        if (!status.success) throw new BackupClientError('invalid_response')
        return status.data
    } catch (error) {
        if (signal?.aborted) throw new BackupClientError('aborted')
        if (error instanceof BackupClientError) throw error
        if (error instanceof ResponseBodyLimitError || error instanceof SyntaxError)
            throw new BackupClientError('invalid_response')
        throw new BackupClientError('unavailable')
    }
}

export const getBackupsStatus = (signal?: AbortSignal) => request('status', signal)

export async function requestBackup(input: BackupStartInput, signal?: AbortSignal) {
    const parsed = startInput.safeParse(input)
    if (!parsed.success) throw new BackupClientError('invalid_input')
    const status = await request('start', signal, parsed.data)
    if (!status.jobs.some((job) => job.requestId === parsed.data.requestId))
        throw new BackupClientError('invalid_response')
    return status
}

export async function saveBackupConfiguration(
    input: BackupConfigurationInput,
    signal?: AbortSignal,
) {
    const parsed = configurationInput.safeParse(input)
    if (!parsed.success) throw new BackupClientError('invalid_input')
    const status = await request('config', signal, parsed.data)
    if (status.configuration.revision <= parsed.data.expectedRevision)
        throw new BackupClientError('invalid_response')
    return status
}
