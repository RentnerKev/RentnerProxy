import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast, type ToastType } from '@rentnerkev/toasts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    BackupClientError,
    getBackupsStatus,
    requestBackup,
    saveBackupConfiguration,
    saveOffHostConfiguration,
    deleteBackup,
    restoreBackup,
} from '@/lib/Backups/backupClient.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
import { managedBackupStatusSchema } from '@/lib/Backups/validation.ts'
import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { BackupsLogicResult, BackupsPageProps } from '../Types/backups-ui.types.ts'

function privateError(error: unknown) {
    return (
        error instanceof BackupClientError &&
        (error.code === 'authentication_required' || error.code === 'permission_denied')
    )
}

export default function useBackupsLogic(props: BackupsPageProps): BackupsLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const queryKey = useMemo(() => ['backups', props.userId] as const, [props.userId])
    const canView = props.permissions.includes(PERMISSIONS.BACKUPS_VIEW)
    const canManage = canView && props.permissions.includes(PERMISSIONS.BACKUPS_MANAGE)
    const [accessRevoked, setAccessRevoked] = useState(false)
    const [pending, setPending] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [uncertain, setUncertain] = useState(false)
    const busy = useRef(false)
    const startRequest = useRef<string | null>(null)
    const mutationAbort = useRef<AbortController | null>(null)
    const liveGeneration = useRef(0)
    const downloadNotice = useRef<string | null>(null)
    const notifyAction = useCallback(
        (type: ToastType, key: string, requestId: string) => {
            const content = t(key)
            const title = t(`toast.titles.${type}`)
            const id = toast[type](content, {
                title,
                dedupeKey: `backups:${props.userId}:${requestId}`,
            })
            toast.update(id, { content, title, type })
        },
        [props.userId, t],
    )
    const artifactRequest = useRef<{
        operation: 'delete' | 'restore'
        jobId: string
        requestId: string
    } | null>(null)
    const query = useQuery({
        queryKey,
        queryFn: ({ signal }) => getBackupsStatus(signal),
        enabled: canView && !accessRevoked,
        retry: false,
        staleTime: Infinity,
        refetchInterval: false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const live = useLiveQuery<unknown>({
        topic: 'backups',
        query: {},
        enabled: canView && !accessRevoked,
        onData: async (value) => {
            const parsed = managedBackupStatusSchema.safeParse(value)
            if (!parsed.success) return
            const generation = liveGeneration.current
            await queryClient.cancelQueries({ queryKey })
            if (generation === liveGeneration.current && canView && !accessRevoked)
                queryClient.setQueryData(queryKey, parsed.data)
        },
        onUnauthorized: () => revoke(new BackupClientError('permission_denied')),
    })
    const forbidden = !canView || accessRevoked || privateError(query.error)
    const status = forbidden ? null : (query.data ?? null)
    const active = status?.jobs.find((job) => job.state === 'queued' || job.state === 'running')
    const maintenanceActive =
        status?.maintenance?.state === 'queued' || status?.maintenance?.state === 'running'
    const locked =
        forbidden ||
        !status ||
        query.isError ||
        pending ||
        maintenanceActive ||
        live === 'disconnected'
    useEffect(() => {
        if (!canManage || forbidden) mutationAbort.current?.abort()
        return () => {
            liveGeneration.current += 1
            mutationAbort.current?.abort()
        }
    }, [canManage, forbidden])

    // oxlint-disable react/set-state-in-effect -- Authorization failures must erase cached administrative data and stop live updates.
    useEffect(() => {
        if (!canView || privateError(query.error)) {
            setAccessRevoked(true)
            setConfirmOpen(false)
            startRequest.current = null
            artifactRequest.current = null
            liveGeneration.current += 1
            queryClient.removeQueries({ queryKey })
        }
    }, [canView, query.error, queryClient, queryKey])
    useEffect(() => {
        const requestId = startRequest.current
        if (requestId && status?.jobs.some((job) => job.requestId === requestId)) {
            startRequest.current = null
            setUncertain(false)
            notifyAction('info', 'admin.backups.messages.accepted', requestId)
        }
    }, [status, notifyAction])
    useEffect(() => {
        const request = artifactRequest.current
        if (!request || !status) return
        if (
            request.operation === 'delete' &&
            !status.jobs.some((job) => job.id === request.jobId)
        ) {
            artifactRequest.current = null
            notifyAction('success', 'admin.backups.messages.deleted', request.requestId)
        }
    }, [status, notifyAction])
    // oxlint-enable react/set-state-in-effect

    useEffect(() => {
        if (!props.downloadError) {
            downloadNotice.current = null
            return
        }
        if (forbidden || downloadNotice.current === props.downloadError) return
        downloadNotice.current = props.downloadError
        notifyAction(
            'error',
            `admin.backups.downloadErrors.${props.downloadError}`,
            `download:${props.downloadError}`,
        )
    }, [props.downloadError, forbidden, notifyAction])

    async function acceptStatus(saved: ManagedBackupStatus, signal: AbortSignal) {
        await queryClient.cancelQueries({ queryKey })
        signal.throwIfAborted()
        queryClient.setQueryData(queryKey, saved)
    }

    function revoke(error: unknown) {
        if (!privateError(error)) return
        setAccessRevoked(true)
        setConfirmOpen(false)
        startRequest.current = null
        artifactRequest.current = null
        liveGeneration.current += 1
        queryClient.removeQueries({ queryKey })
    }

    async function handleConfirmStart() {
        if (!canManage || locked || active || busy.current) return
        busy.current = true
        setPending(true)
        const action = new AbortController()
        mutationAbort.current = action
        startRequest.current ??= crypto.randomUUID()
        const requestId = startRequest.current
        try {
            await queryClient.cancelQueries({ queryKey })
            const saved = await requestBackup({ requestId }, action.signal)
            setUncertain(false)
            await acceptStatus(saved, action.signal)
            if (startRequest.current === requestId) {
                startRequest.current = null
                notifyAction('info', 'admin.backups.messages.accepted', requestId)
            }
        } catch (error) {
            if (action.signal.aborted) return
            if (!privateError(error) && startRequest.current !== requestId) return
            revoke(error)
            const code = error instanceof BackupClientError ? error.code : 'unavailable'
            const unknown = ['unavailable', 'invalid_response', 'aborted'].includes(code)
            if (!unknown) startRequest.current = null
            setUncertain(unknown)
            notifyAction(
                unknown ? 'warning' : 'error',
                unknown ? 'admin.backups.messages.uncertain' : `admin.backups.errors.${code}`,
                requestId,
            )
        } finally {
            mutationAbort.current = null
            busy.current = false
            setPending(false)
            setConfirmOpen(false)
        }
    }

    async function handleSaveConfiguration(
        save: (signal: AbortSignal) => Promise<ManagedBackupStatus>,
    ) {
        if (!canManage || locked || busy.current) throw new BackupClientError('permission_denied')
        busy.current = true
        setPending(true)
        const action = new AbortController()
        mutationAbort.current = action
        try {
            await queryClient.cancelQueries({ queryKey })
            const saved = await save(action.signal)
            await acceptStatus(saved, action.signal)
            return saved
        } catch (error) {
            revoke(error)
            throw error
        } finally {
            mutationAbort.current = null
            busy.current = false
            setPending(false)
        }
    }

    async function handleArtifactAction(jobId: string, operation: 'delete' | 'restore') {
        if (!canManage || locked || active || busy.current) throw new BackupClientError('busy')
        const job = status?.jobs.find((entry) => entry.id === jobId)
        if (!job) throw new BackupClientError('not_found')
        if (
            operation === 'restore' &&
            (job.state !== 'succeeded' || !job.retained || job.artifact?.id !== job.id)
        )
            throw new BackupClientError('artifact_invalid')
        busy.current = true
        setPending(true)
        const action = new AbortController()
        mutationAbort.current = action
        if (
            artifactRequest.current?.jobId !== jobId ||
            artifactRequest.current.operation !== operation
        )
            artifactRequest.current = { jobId, operation, requestId: crypto.randomUUID() }
        const requestId = artifactRequest.current.requestId
        try {
            const input = {
                jobId,
                requestId,
                metadataSha256: job.artifact?.metadataSha256 ?? null,
            }
            const saved = await (operation === 'delete' ? deleteBackup : restoreBackup)(
                input,
                action.signal,
            )
            await acceptStatus(saved, action.signal)
            if (artifactRequest.current?.requestId === requestId) {
                const deleted =
                    operation === 'delete' && !saved.jobs.some((entry) => entry.id === jobId)
                if (deleted) artifactRequest.current = null
                notifyAction(
                    deleted ? 'success' : 'info',
                    operation === 'restore'
                        ? 'admin.backups.messages.restoreAccepted'
                        : deleted
                          ? 'admin.backups.messages.deleted'
                          : 'admin.backups.messages.actionAccepted',
                    requestId,
                )
            }
        } catch (error) {
            if (action.signal.aborted) return
            if (!privateError(error) && artifactRequest.current?.requestId !== requestId) return
            revoke(error)
            const code = error instanceof BackupClientError ? error.code : 'unavailable'
            const unknown = ['unavailable', 'invalid_response', 'aborted'].includes(code)
            if (!unknown) artifactRequest.current = null
            notifyAction(
                unknown ? 'warning' : 'error',
                unknown ? 'admin.backups.messages.actionUncertain' : `admin.backups.errors.${code}`,
                requestId,
            )
            throw error
        } finally {
            mutationAbort.current = null
            busy.current = false
            setPending(false)
        }
    }

    return {
        state: {
            canManage,
            forbidden,
            isLoading: canView && !forbidden && query.isPending,
            isError: query.isError,
            locked,
            pending,
            confirmOpen,
            uncertain,
            status,
            jobs: status?.jobs ?? [],
            active,
            lastSuccess: status?.jobs.findLast((job) => job.state === 'succeeded'),
        },
        handler: {
            handleRestore: (jobId) => handleArtifactAction(jobId, 'restore'),
            handleDelete: (jobId) => handleArtifactAction(jobId, 'delete'),
            handleStart: () => {
                if (canManage && !locked && !active && !busy.current) setConfirmOpen(true)
            },
            handleConfirmOpenChange: (open) => {
                if (!busy.current) setConfirmOpen(open)
            },
            handleConfirmStart,
            handleSave: (input) =>
                handleSaveConfiguration((signal) => saveBackupConfiguration(input, signal)),
            handleSaveOffHost: (input) =>
                handleSaveConfiguration((signal) => saveOffHostConfiguration(input, signal)),
        },
    }
}
