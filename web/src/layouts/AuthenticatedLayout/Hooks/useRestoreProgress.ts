import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { backupRestoreSnapshotSchema } from '@/lib/Backups/validation.ts'
import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'
import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'

export default function useRestoreProgress() {
    const queryClient = useQueryClient()
    const router = useRouter()
    const [maintenance, setMaintenance] = useState<ManagedBackupMaintenance | null>(null)
    const current = useRef<ManagedBackupMaintenance | null>(null)
    const completing = useRef<string | null>(null)
    const mounted = useRef(true)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])
    const handleSnapshot = useCallback(
        async (value: unknown) => {
            const parsed = backupRestoreSnapshotSchema.safeParse(value)
            if (!parsed.success) return
            const next = parsed.data.maintenance
            if (!next || next.operation !== 'restore') return
            if (
                next.state !== 'queued' &&
                next.state !== 'running' &&
                current.current?.id !== next.id
            )
                return
            // Preserve the route and its component state below the screen. A disconnect
            // or empty snapshot cannot confirm that destructive replacement finished.
            current.current = next
            setMaintenance(next)
            if (next.state !== 'succeeded' || completing.current === next.id) return
            completing.current = next.id
            try {
                await queryClient.cancelQueries()
                queryClient.clear()
                await router.invalidate({ sync: true })
                if (mounted.current && current.current?.id === next.id) {
                    current.current = null
                    setMaintenance(null)
                }
            } catch {
                completing.current = null
            }
        },
        [queryClient, router],
    )
    const status = useLiveQuery<unknown>({
        topic: 'backup-restore',
        query: {},
        enabled: true,
        onData: handleSnapshot,
        onUnauthorized: () => {
            void router.invalidate({ sync: true }).catch(() => undefined)
        },
    })
    const canDismiss =
        maintenance !== null &&
        (maintenance.state === 'failed' || maintenance.state === 'interrupted') &&
        (maintenance.phase === 'queued' || maintenance.phase === 'validating')
    function dismiss() {
        if (!canDismiss) return
        current.current = null
        setMaintenance(null)
    }
    return { maintenance, status, active: maintenance !== null, canDismiss, dismiss }
}
