import { useEffect, useId, useRef, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { toast } from '@rentnerkev/toasts'
import { BackupClientError } from '@/lib/Backups/backupClient.ts'
import { offHostConfigurationUpdateSchema } from '@/lib/Backups/offHostValidation.ts'
import type { OffHostStatus } from '@/lib/Backups/Types/off-host.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    OffHostBackupLogicResult,
    OffHostBackupProps,
    OffHostFormValues,
} from '../Types/backups-ui.types.ts'

const fields = (configuration: OffHostStatus): OffHostFormValues => ({
    enabled: configuration.enabled,
    endpoint: configuration.endpoint,
    region: configuration.region,
    bucket: configuration.bucket,
    prefix: configuration.prefix,
    accessKeyId: '',
    secretAccessKey: '',
    recoveryKey: '',
    recoveryKeySaved: false,
})
const payload = (value: OffHostFormValues) => ({
    enabled: value.enabled,
    endpoint: value.endpoint.trim(),
    region: value.region.trim(),
    bucket: value.bucket.trim(),
    prefix: value.prefix.trim(),
    ...(value.accessKeyId ? { accessKeyId: value.accessKeyId } : {}),
    ...(value.secretAccessKey ? { secretAccessKey: value.secretAccessKey } : {}),
    ...(value.recoveryKey
        ? { recoveryKey: value.recoveryKey, recoveryKeySaved: value.recoveryKeySaved }
        : {}),
})

export default function useOffHostBackupLogic(props: OffHostBackupProps): OffHostBackupLogicResult {
    const { t } = useTranslationStore()
    const id = useId()
    const [base, setBase] = useState(props.configuration)
    const [pending, setPending] = useState(false)
    const [downloaded, setDownloaded] = useState(false)
    const busy = useRef(false)
    const receipt = useRef<{ fingerprint: string; requestId: string } | null>(null)
    const form = useForm({
        defaultValues: fields(base),
        onSubmit: async ({ value }) => {
            if (props.locked || busy.current || base.revision !== props.configuration.revision)
                return
            if (value.recoveryKey && (!value.recoveryKeySaved || !downloaded)) return
            const fingerprint = JSON.stringify({
                ...payload(value),
                expectedRevision: base.revision,
            })
            if (receipt.current?.fingerprint !== fingerprint)
                receipt.current = { fingerprint, requestId: crypto.randomUUID() }
            const requestId = receipt.current.requestId
            const parsed = offHostConfigurationUpdateSchema.omit({ actorId: true }).safeParse({
                ...payload(value),
                expectedRevision: base.revision,
                requestId,
            })
            if (!parsed.success) return
            busy.current = true
            setPending(true)
            try {
                const saved = await props.onSave(parsed.data)
                if (!saved.offHost) throw new BackupClientError('invalid_response')
                setBase(saved.offHost)
                form.reset(fields(saved.offHost))
                setDownloaded(false)
                receipt.current = null
                toast.success(t('admin.backups.messages.saved'), {
                    title: t('toast.titles.success'),
                })
            } catch (error) {
                const code = error instanceof BackupClientError ? error.code : 'unavailable'
                if (code !== 'aborted')
                    toast.error(t(`admin.backups.errors.${code}`), {
                        title: t('toast.titles.error'),
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
    const locked = props.locked || pending
    const hasKey = !!values.recoveryKey || !!base.keyId
    const savedKey = !values.recoveryKey || (values.recoveryKeySaved && downloaded)
    const valid = offHostConfigurationUpdateSchema
        .omit({ actorId: true, requestId: true })
        .safeParse({ ...payload(values), expectedRevision: base.revision }).success
    const targetValid =
        !values.enabled ||
        (!!values.endpoint &&
            !!values.region &&
            !!values.bucket &&
            hasKey &&
            (base.configured || (!!values.accessKeyId && !!values.secretAccessKey)))
    useEffect(() => {
        if (!dirty && !busy.current && base.revision !== props.configuration.revision) {
            setBase(props.configuration)
            form.reset(fields(props.configuration))
            setDownloaded(false)
        }
    }, [base.revision, dirty, form, props.configuration])
    return {
        state: {
            id,
            ...values,
            locked,
            downloaded,
            recoveryCommand:
                'bun --no-env-file scripts/recover-offhost-backup.ts --target-file <target.json> --key-file <recovery-key.json> --object <targetId/jobId.rpbk> --output <backup-dir>',
            restoreCommand:
                'bun --no-env-file scripts/production-restore.ts --input <backup-dir> --confirm-replace',

            conflict,
            canSave: dirty && !locked && !conflict && savedKey && targetValid && valid,
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                if (!locked && targetValid && savedKey) void form.handleSubmit()
            },
            handleTextChange: (name, value) => {
                if (!locked) form.setFieldValue(name, value)
            },
            handleEnabledChange: (value) => {
                if (!locked) form.setFieldValue('enabled', value)
            },
            handleSavedChange: (value) => {
                if (!locked && downloaded) form.setFieldValue('recoveryKeySaved', value)
            },
            handleGenerate: () => {
                if (locked) return
                try {
                    const bytes = crypto.getRandomValues(new Uint8Array(32))
                    form.setFieldValue('recoveryKey', btoa(String.fromCharCode(...bytes)))
                    form.setFieldValue('recoveryKeySaved', false)
                    setDownloaded(false)
                } catch {
                    toast.error(t('admin.backups.offHost.keyUnavailable'), {
                        title: t('toast.titles.error'),
                    })
                }
            },
            handleDownload: () => {
                if (locked || !values.recoveryKey) return
                const blob = new Blob(
                    [
                        JSON.stringify(
                            {
                                format: 'rentnerproxy-off-host-recovery-key',
                                version: 1,
                                recoveryKey: values.recoveryKey,
                            },
                            null,
                            2,
                        ),
                    ],
                    { type: 'application/json' },
                )
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = 'rentnerproxy-recovery-key.json'
                anchor.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
                setDownloaded(true)
            },
            handleReset: () => {
                if (locked) return
                setBase(props.configuration)
                form.reset(fields(props.configuration))
                setDownloaded(false)
                receipt.current = null
            },
        },
    }
}
