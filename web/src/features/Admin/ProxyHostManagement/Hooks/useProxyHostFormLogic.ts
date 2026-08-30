import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { MAX_PROXY_HOST_DOMAINS } from '../../../../config/proxy-hosts.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { proxyHostManagementQueryKeys } from '../queryKeys'
import { createProxyHostHandler, updateProxyHostHandler } from '../server'
import type {
    ProxyHostEditorFormValues,
    ProxyHostFormModalProps,
} from '../Types/proxy-host-form.types'
import { proxyHostFormSchema } from '../validation'

type UseProxyHostFormLogicParams = Pick<
    ProxyHostFormModalProps,
    'canEnable' | 'canDisable' | 'mode' | 'onSuccess' | 'proxyHost'
>

export default function useProxyHostFormLogic({
    canEnable,
    canDisable,
    mode,
    onSuccess,
    proxyHost,
}: UseProxyHostFormLogicParams) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [domainKeys, setDomainKeys] = useState(() =>
        (proxyHost?.domains ?? ['']).map(() => crypto.randomUUID()),
    )
    const [pendingDisableValues, setPendingDisableValues] =
        useState<ProxyHostEditorFormValues | null>(null)
    const mutation = useMutation({
        mutationFn: (values: ProxyHostEditorFormValues) => {
            const data = proxyHostFormSchema.parse(values)

            if (mode === 'create') return createProxyHostHandler({ data })
            if (!proxyHost) throw new Error('admin.proxyHosts.errors.proxy_host_not_found')

            return updateProxyHostHandler({ data: { ...data, proxyHostId: proxyHost.id } })
        },
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            await queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.all })
            toast.success(result.message)
            setPendingDisableValues(null)
            onSuccess()
        },
        onError: () => toast.error('admin.proxyHosts.errors.saveFailed'),
    })
    const defaultValues: ProxyHostEditorFormValues = {
        domains: proxyHost ? [...proxyHost.domains] : [''],
        forwardScheme: proxyHost?.forwardScheme ?? 'http',
        forwardHost: proxyHost?.forwardHost ?? '',
        forwardPort: String(proxyHost?.forwardPort ?? 80),
        enabled: proxyHost?.enabled ?? true,
    }
    const form = useForm({
        defaultValues,
        validators: { onSubmit: proxyHostFormSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()

            if (mode === 'edit' && proxyHost?.enabled && !value.enabled) {
                setPendingDisableValues({ ...value, domains: [...value.domains] })
                return
            }

            await mutation.mutateAsync(value).catch(() => undefined)
        },
    })
    const addDomain = useCallback(() => {
        if (form.state.values.domains.length >= MAX_PROXY_HOST_DOMAINS || mutation.isPending) return
        form.pushFieldValue('domains', '')
        setDomainKeys((keys) => [...keys, crypto.randomUUID()])
    }, [form, mutation.isPending])
    const removeDomain = useCallback(
        (index: number) => {
            if (form.state.values.domains.length <= 1 || mutation.isPending) return
            void form.removeFieldValue('domains', index)
            setDomainKeys((keys) => keys.filter((_key, position) => position !== index))
        },
        [form, mutation.isPending],
    )
    const setDisableConfirmationOpen = useCallback((open: boolean) => {
        if (!open) setPendingDisableValues(null)
    }, [])
    const confirmDisable = useCallback(async () => {
        if (pendingDisableValues) {
            await mutation.mutateAsync(pendingDisableValues).catch(() => undefined)
        }
    }, [mutation, pendingDisableValues])

    return {
        state: {
            canChangeEnabled: mode === 'create' || (proxyHost?.enabled ? canDisable : canEnable),
            disableConfirmationOpen: pendingDisableValues !== null,
            domainKeys,
            form,
            isPending: mutation.isPending,
        },
        handler: { addDomain, removeDomain, confirmDisable, setDisableConfirmationOpen },
    }
}
