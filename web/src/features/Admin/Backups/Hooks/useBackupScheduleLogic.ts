import { useEffect, useId, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { toast } from '@rentnerkev/toasts'
import type { ManagedBackupConfiguration } from '@/lib/Backups/Types/backups.types.ts'
import { BackupClientError } from '@/lib/Backups/backupClient.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { backupScheduleFormSchema } from '../validation.ts'
import type { BackupScheduleLogicResult, BackupScheduleProps } from '../Types/backups-ui.types.ts'

const fields = (configuration: ManagedBackupConfiguration) => ({
    enabled: configuration.enabled,
    intervalHours: String(configuration.intervalHours),
    retentionCount: String(configuration.retentionCount),
})

export default function useBackupScheduleLogic(
    props: BackupScheduleProps,
): BackupScheduleLogicResult {
    const { t } = useTranslationStore()
    const id = useId()
    const [base, setBase] = useState(props.configuration)
    const [pending, setPending] = useState(false)
    const busy = useRef(false)
    const receipt = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const form = useForm({
        defaultValues: fields(base),
        onSubmit: async ({ value }) => {
            if (props.locked || busy.current || base.revision !== props.configuration.revision)
                return
            const parsed = backupScheduleFormSchema.safeParse(value)
            if (!parsed.success) {
                toast.error(t('admin.backups.errors.invalid_input'), {
                    title: t('toast.titles.error'),
                    dedupeKey: `backup-schedule:${props.storeId}:validation`,
                })
                return
            }
            busy.current = true
            setPending(true)
            const fingerprint = JSON.stringify({ ...parsed.data, expectedRevision: base.revision })
            if (receipt.current?.fingerprint !== fingerprint)
                receipt.current = { fingerprint, requestId: crypto.randomUUID() }
            const requestId = receipt.current.requestId
            try {
                const saved = await props.onSave({
                    ...parsed.data,
                    expectedRevision: base.revision,
                    requestId,
                })
                receipt.current = null
                setBase(saved.configuration)
                form.reset(fields(saved.configuration))
                toast.success(t('admin.backups.messages.saved'), {
                    title: t('toast.titles.success'),
                    dedupeKey: `backup-schedule:${requestId}:saved`,
                })
            } catch (error) {
                const code = error instanceof BackupClientError ? error.code : 'unavailable'
                if (code !== 'aborted')
                    toast.error(t(`admin.backups.errors.${code}`), {
                        title: t('toast.titles.error'),
                        dedupeKey: `backup-schedule:${requestId}:${code}`,
                    })
            } finally {
                busy.current = false
                setPending(false)
            }
        },
    })
    const values = useStore(form.store, (snapshot) => snapshot.values)
    const dirty = useStore(form.store, (snapshot) => snapshot.isDirty)
    const conflict = base.revision !== props.configuration.revision
    const valid = backupScheduleFormSchema.safeParse(values).success
    useEffect(() => {
        if (!dirty && !busy.current && base.revision !== props.configuration.revision) {
            setBase(props.configuration)
            form.reset(fields(props.configuration))
        }
    }, [base.revision, dirty, form, props.configuration])
    const locked = props.locked || pending
    return {
        state: {
            id,
            ...values,
            conflict,
            pending,
            locked,
            canSave: dirty && valid && !locked && !conflict,
            valid,
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                if (!locked) void form.handleSubmit()
            },
            handleEnabledChange: (value) => form.setFieldValue('enabled', value),
            handleIntervalChange: (value) => form.setFieldValue('intervalHours', value),
            handleRetentionChange: (value) => form.setFieldValue('retentionCount', value),
            handleReset: () => {
                if (locked) return
                setBase(props.configuration)
                form.reset(fields(props.configuration))
                receipt.current = null
            },
        },
    }
}
