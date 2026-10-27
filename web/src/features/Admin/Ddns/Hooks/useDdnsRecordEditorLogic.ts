import {
    dnsProviderForId,
    supportsDdns,
    supportsProxyOption,
} from '@/lib/DnsConnections/dnsProviders.ts'
import { useForm, useStore } from '@tanstack/react-form'
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { toast } from '@rentnerkev/toasts'
import { DDNS_AUTO_ZONE } from '@/config/ddns.config.ts'
import { buildDdnsRecordDraft, ddnsRecordEditorValues } from '@/lib/Ddns/recordEditor.ts'
import { canonicalDdnsName, createDdnsTargetId } from '@/lib/Ddns/targets.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DdnsRecordEditorProps } from '../Types/ddns-editor.types.ts'
import {
    connectionSupportsOperation,
    verifiedConnectionZones,
} from '@/lib/DnsConnections/connectionEligibility.ts'

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
                const selected = props.connections.find((item) => item.id === value.connectionId)
                const provider = dnsProviderForId(
                    props.providers,
                    selected?.provider ??
                        props.providerBindings.find(
                            (binding) => binding.connectionId === value.connectionId,
                        )?.provider ??
                        '',
                )
                if (
                    (!props.editor.target &&
                        (!selected ||
                            !connectionSupportsOperation(
                                selected,
                                props.providers,
                                value.recordType,
                            ))) ||
                    !(value.recordType === 'both'
                        ? supportsDdns(provider, 'A') && supportsDdns(provider, 'AAAA')
                        : supportsDdns(provider, value.recordType)) ||
                    !supportsProxyOption(provider, value.proxied)
                )
                    throw new Error('admin.dnsConnections.providers.unavailable')
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
                        error instanceof Error &&
                            (error.message.startsWith('admin.ddns.') ||
                                error.message.startsWith('admin.dnsConnections.') ||
                                error.message.startsWith('admin.providers.'))
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
    const provider = dnsProviderForId(
        props.providers,
        connection?.provider ??
            props.providerBindings.find((binding) => binding.connectionId === values.connectionId)
                ?.provider ??
            '',
    )
    const recordTypeAvailable =
        values.recordType === 'both'
            ? supportsDdns(provider, 'A') && supportsDdns(provider, 'AAAA')
            : supportsDdns(provider, values.recordType)
    const operationSupported = recordTypeAvailable && supportsProxyOption(provider, values.proxied)
    const connectionEligible =
        !!props.editor.target ||
        (!!connection &&
            connectionSupportsOperation(connection, props.providers, values.recordType))
    const operationUnavailable = !!values.connectionId && !operationSupported
    const connectionOptions = props.connections
        .filter((item) => {
            const available = dnsProviderForId(props.providers, item.provider)
            return supportsDdns(available, 'A') || supportsDdns(available, 'AAAA')
        })
        .map((item) => ({
            value: item.id,
            label: item.name,
        }))
    if (
        props.editor.target &&
        !connectionOptions.some((item) => item.value === props.editor.target?.connectionId)
    )
        connectionOptions.push({
            value: props.editor.target.connectionId,
            label: `${t('admin.ddns.records.savedConnection')} (${props.editor.target.connectionId})`,
        })
    const zoneOptions = [
        { value: DDNS_AUTO_ZONE, label: t('admin.ddns.form.autoZone') },
        ...((props.editor.target
            ? connection?.zones
            : connection
              ? verifiedConnectionZones(connection)
              : []
        )?.map((zone) => ({ value: zone.id, label: zone.name })) ?? []),
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
            locked: props.locked || !operationSupported || !connectionEligible,
            operationSupported,
            operationUnavailable,
            recordType: values.recordType,
            savedRecordType: props.editor.target?.recordType,
            recordTypeAvailable,
            proxyAvailable: provider?.capabilities.proxyOptions === 'cloudflare',
            canChooseConnection: props.canChooseConnection,
            locale,
            selectLocale:
                language === 'de' || language === 'es' || language === 'fr'
                    ? language
                    : ('en' as const),
            recordTypeOptions: [
                ...(supportsDdns(provider, 'A')
                    ? [{ value: 'A' as const, label: t('admin.ddns.form.ipv4') }]
                    : []),
                ...(supportsDdns(provider, 'AAAA')
                    ? [{ value: 'AAAA' as const, label: t('admin.ddns.form.ipv6') }]
                    : []),
                ...(!props.editor.target &&
                supportsDdns(provider, 'A') &&
                supportsDdns(provider, 'AAAA')
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
                if (!props.editor.target) {
                    const selected = props.connections.find((item) => item.id === id)
                    const selectedProvider = dnsProviderForId(
                        props.providers,
                        selected?.provider ?? '',
                    )
                    if (!supportsProxyOption(selectedProvider, true))
                        form.setFieldValue('proxied', false)
                    const current = form.getFieldValue('recordType')
                    if (current !== 'both' && !supportsDdns(selectedProvider, current)) {
                        const recordType = selectedProvider?.capabilities.addressRecordTypes[0]
                        if (recordType) form.setFieldValue('recordType', recordType)
                    }
                }
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
