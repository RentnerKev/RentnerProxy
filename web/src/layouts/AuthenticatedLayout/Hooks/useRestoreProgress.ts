import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from '@rentnerkev/toasts'
import { RESTORE_COMPLETION_VISIBLE_MS } from '@/config/backups.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { backupRestoreSnapshotSchema } from '@/lib/Backups/validation.ts'
import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'
import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'

export default function useRestoreProgress() {
    const queryClient = useQueryClient()
    const router = useRouter()
    const { t } = useTranslationStore()
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
            const previous = current.current
            if (previous?.id === next.id && next.progressPercent < previous.progressPercent) return
            if (previous && previous.id !== next.id && next.requestedAt <= previous.requestedAt)
                return
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
                await Promise.all([
                    router.invalidate({ sync: true }),
                    new Promise<void>((resolve) =>
                        setTimeout(resolve, RESTORE_COMPLETION_VISIBLE_MS),
                    ),
                ])
                if (mounted.current && current.current?.id === next.id) {
                    toast.success(t('admin.backups.messages.restored'), {
                        title: t('toast.titles.success'),
                        dedupeKey: `backup-restore:${next.id}`,
                    })
                    current.current = null
                    setMaintenance(null)
                }
            } catch {
                completing.current = null
            }
        },
        [queryClient, router, t],
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
        ['queued', 'preparing', 'validating'].includes(maintenance.phase)
    function dismiss() {
        if (!canDismiss) return
        current.current = null
        setMaintenance(null)
    }
    return { maintenance, status, active: maintenance !== null, canDismiss, dismiss }
}
