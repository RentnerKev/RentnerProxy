import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { BACKUP_UI_POLICY } from '@/config/backups.config.ts'
import {
    BackupClientError,
    getBackupsStatus,
    requestBackup,
    saveBackupConfiguration,
} from '@/lib/Backups/backupClient.ts'
import type { BackupConfigurationInput } from '@/lib/Backups/Types/backups-client.types.ts'
import type { ManagedBackupStatus } from '@/lib/Backups/Types/backups.types.ts'
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
    const [notice, setNotice] = useState('')
    const [uncertain, setUncertain] = useState(false)
    const busy = useRef(false)
    const startRequest = useRef<string | null>(null)
    const mutationAbort = useRef<AbortController | null>(null)
    const query = useQuery({
        queryKey,
        queryFn: ({ signal }) => getBackupsStatus(signal),
        enabled: canView && !accessRevoked,
        retry: false,
        refetchInterval: pending || accessRevoked ? false : BACKUP_UI_POLICY.pollIntervalMs,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
    })
    const forbidden = !canView || accessRevoked || privateError(query.error)
    const status = forbidden ? null : (query.data ?? null)
    const active = status?.jobs.find((job) => job.state === 'queued' || job.state === 'running')
    const locked = forbidden || !status || query.isError || pending
    useEffect(() => {
        if (!canManage || forbidden) mutationAbort.current?.abort()
        return () => mutationAbort.current?.abort()
    }, [canManage, forbidden])

    // oxlint-disable react/set-state-in-effect -- Authorization failures must erase cached administrative data and stop polling.
    useEffect(() => {
        if (!canView || privateError(query.error)) {
            setAccessRevoked(true)
            setConfirmOpen(false)
            startRequest.current = null
            queryClient.removeQueries({ queryKey })
        }
    }, [canView, query.error, queryClient, queryKey])
    useEffect(() => {
        if (status?.jobs.some((job) => job.requestId === startRequest.current)) {
            startRequest.current = null
            setUncertain(false)
            setNotice(t('admin.backups.messages.accepted'))
        }
    }, [status, t])
    // oxlint-enable react/set-state-in-effect

    async function acceptStatus(saved: ManagedBackupStatus, signal: AbortSignal) {
        await queryClient.cancelQueries({ queryKey })
        signal.throwIfAborted()
        queryClient.setQueryData(queryKey, saved)
        void queryClient.invalidateQueries({ queryKey })
    }

    function revoke(error: unknown) {
        if (!privateError(error)) return
        setAccessRevoked(true)
        setConfirmOpen(false)
        startRequest.current = null
        queryClient.removeQueries({ queryKey })
    }

    async function handleConfirmStart() {
        if (!canManage || locked || active || busy.current) return
        busy.current = true
        setPending(true)
        const action = new AbortController()
        mutationAbort.current = action
        startRequest.current ??= crypto.randomUUID()
        try {
            await queryClient.cancelQueries({ queryKey })
            const saved = await requestBackup({ requestId: startRequest.current }, action.signal)
            startRequest.current = null
            setUncertain(false)
            setNotice(t('admin.backups.messages.accepted'))
            await acceptStatus(saved, action.signal)
        } catch (error) {
            if (action.signal.aborted) return
            revoke(error)
            const code = error instanceof BackupClientError ? error.code : 'unavailable'
            const unknown = ['unavailable', 'invalid_response', 'aborted'].includes(code)
            if (!unknown) startRequest.current = null
            setUncertain(unknown)
            setNotice(
                t(unknown ? 'admin.backups.messages.uncertain' : `admin.backups.errors.${code}`),
            )
            void queryClient.invalidateQueries({ queryKey })
        } finally {
            mutationAbort.current = null
            busy.current = false
            setPending(false)
            setConfirmOpen(false)
        }
    }

    async function handleSave(input: BackupConfigurationInput) {
        if (!canManage || locked || busy.current) throw new BackupClientError('permission_denied')
        busy.current = true
        setPending(true)
        const action = new AbortController()
        mutationAbort.current = action
        try {
            await queryClient.cancelQueries({ queryKey })
            const saved = await saveBackupConfiguration(input, action.signal)
            await acceptStatus(saved, action.signal)
            return saved
        } catch (error) {
            revoke(error)
            if (!action.signal.aborted) void queryClient.invalidateQueries({ queryKey })
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
            refreshing: query.isFetching,
            locked,
            pending,
            confirmOpen,
            uncertain,
            notice,
            status,
            jobs: status?.jobs ?? [],
            active,
            lastSuccess: status?.jobs.findLast((job) => job.state === 'succeeded'),
        },
        handler: {
            handleRefresh: () => {
                if (!forbidden && !busy.current) void query.refetch()
            },
            handleStart: () => {
                if (canManage && !locked && !active && !busy.current) setConfirmOpen(true)
            },
            handleConfirmOpenChange: (open) => {
                if (!busy.current) setConfirmOpen(open)
            },
            handleConfirmStart,
            handleSave,
        },
    }
}
