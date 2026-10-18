import { useForm, useStore } from '@tanstack/react-form'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { toast } from '@rentnerkev/toasts'
import { DDNS_AUTO_ZONE } from '@/config/ddns.config.ts'
import { buildDdnsRecordDraft, ddnsRecordEditorValues } from '@/lib/Ddns/recordEditor.ts'
import { canonicalDdnsName, createDdnsTargetId } from '@/lib/Ddns/targets.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DdnsRecordEditorProps } from '../Types/ddns-editor.types.ts'

export default function useDdnsRecordEditorLogic(props: DdnsRecordEditorProps) {
    const { t, language, locale } = useTranslationStore()
    const formId = useId()
    const [defaults] = useState(() => ddnsRecordEditorValues(props.editor.target))
    const [focusId, setFocusId] = useState<string | null>(null)
    const inputs = useRef(new Map<string, HTMLInputElement>())
    const form = useForm({
        defaultValues: defaults,
        onSubmit: async ({ value }) => {
            if (props.locked || props.stale) return
            try {
                await props.onSave(
                    buildDdnsRecordDraft(
                        props.editor.draft,
                        value,
                        props.connections,
                        props.editor.target,
                    ),
                    props.editor.revision,
                )
            } catch (error) {
                toast.error(
                    t(
                        error instanceof Error && error.message.startsWith('admin.ddns.')
                            ? error.message
                            : 'admin.ddns.errors.invalid_input',
                    ),
                    { title: t('toast.titles.error') },
                )
            }
        },
    })
    const values = useStore(form.store, (state) => state.values)
    const connection = props.connections.find((item) => item.id === values.connectionId)
    const connectionOptions = props.connections.map((item) => ({
        value: item.id,
        label: item.name,
    }))
    if (props.editor.target && !connection)
        connectionOptions.push({
            value: props.editor.target.connectionId,
            label: t('admin.ddns.records.savedConnection'),
        })
    const zoneOptions = [
        { value: DDNS_AUTO_ZONE, label: t('admin.ddns.form.autoZone') },
        ...(connection?.zones.map((zone) => ({ value: zone.id, label: zone.name })) ?? []),
    ]
    if (props.editor.target && !zoneOptions.some((zone) => zone.value === values.zoneId))
        zoneOptions.push({
            value: values.zoneId,
            label: props.editor.target.name.replace(/^\*\./u, ''),
        })
    useEffect(() => {
        if (focusId) inputs.current.get(focusId)?.focus()
    }, [focusId])
    function addDomain(afterId?: string) {
        if (props.pending || values.domains.length >= 100) return
        const rows = form.getFieldValue('domains')
        const index = afterId ? rows.findIndex((row) => row.id === afterId) : rows.length - 1
        const next = rows[index + 1]
        if (next && !next.value.trim()) {
            inputs.current.get(next.id)?.focus()
            return
        }
        const added = { id: createDdnsTargetId(), value: '' }
        form.setFieldValue('domains', [
            ...rows.slice(0, index + 1),
            added,
            ...rows.slice(index + 1),
        ])
        setFocusId(added.id)
    }
    return {
        state: {
            formId,
            editing: !!props.editor.target,
            domains: values.domains,
            connectionId: values.connectionId,
            zoneId: values.zoneId,
            connectionOptions,
            zoneOptions,
            pending: props.pending,
            stale: props.stale,
            locked: props.locked,
            canChooseConnection: props.canChooseConnection,
            locale,
            selectLocale:
                language === 'de' || language === 'es' || language === 'fr'
                    ? language
                    : ('en' as const),
            recordTypeOptions: [
                { value: 'A' as const, label: t('admin.ddns.form.ipv4') },
                { value: 'AAAA' as const, label: t('admin.ddns.form.ipv6') },
                ...(!props.editor.target
                    ? [{ value: 'both' as const, label: t('admin.ddns.editor.both') }]
                    : []),
            ],
        },
        handler: {
            close: () => {
                if (!props.pending) props.onClose()
            },
            submit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                void form.handleSubmit()
            },
            changeConnection: (id: string) => {
                form.setFieldValue('connectionId', id)
                form.setFieldValue('zoneId', DDNS_AUTO_ZONE)
            },
            changeZone: (id: string) => form.setFieldValue('zoneId', id),
            addDomain,
            changeDomain: (id: string, value: string) =>
                form.setFieldValue('domains', (rows) =>
                    rows.map((row) => (row.id === id ? { ...row, value } : row)),
                ),
            removeDomain: (id: string) => {
                if (!props.pending && values.domains.length > 1)
                    form.setFieldValue('domains', (rows) => rows.filter((row) => row.id !== id))
            },
            captureInput: (id: string, input: HTMLInputElement | null) => {
                if (input) inputs.current.set(id, input)
                else inputs.current.delete(id)
            },
            domainKey: (event: KeyboardEvent<HTMLInputElement>, id: string) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                const current = form.getFieldValue('domains').find((row) => row.id === id)
                if (!current?.value.trim() || props.editor.target) return
                try {
                    canonicalDdnsName(current.value)
                    addDomain(id)
                } catch {
                    toast.error(t('admin.ddns.validation.domain'), {
                        title: t('toast.titles.error'),
                    })
                }
            },
        },
        form,
    }
}
