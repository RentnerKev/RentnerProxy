import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { trustedCaManagementQueryKeys } from '../../TrustedCaManagement/queryKeys'
import { getAssignableTrustedCasHandler } from '../../TrustedCaManagement/server'
import { certificateManagementQueryKeys } from '../../CertificateManagement/queryKeys'
import { getAssignableCertificatesHandler } from '../../CertificateManagement/server'
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
    'canEnable' | 'canDisable' | 'canAssignCertificates' | 'mode' | 'onSuccess' | 'proxyHost'
>

export default function useProxyHostFormLogic({
    canEnable,
    canDisable,
    canAssignCertificates = false,
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
    const trustedCasQuery = useQuery({
        queryKey: trustedCaManagementQueryKeys.assignable,
        queryFn: () => getAssignableTrustedCasHandler(),
        staleTime: 30_000,
    })
    const certificatesQuery = useQuery({
        queryKey: certificateManagementQueryKeys.assignable,
        queryFn: () => getAssignableCertificatesHandler(),
        enabled: canAssignCertificates,
        staleTime: 30_000,
    })
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
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: trustedCaManagementQueryKeys.all }),
                queryClient.invalidateQueries({
                    queryKey: proxyHostManagementQueryKeys.all,
                    exact: true,
                }),
                queryClient.invalidateQueries({
                    queryKey: proxyHostManagementQueryKeys.runtimeStatus,
                }),
                queryClient.invalidateQueries({
                    queryKey: certificateManagementQueryKeys.assignable,
                }),
            ])
            if (result.runtimeStatus === 'pending')
                toast.warning('admin.proxyHosts.runtime.savedPending')
            else toast.success(result.message)
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
        certificateId: proxyHost?.certificateId ?? null,
        forceHttps: proxyHost?.forceHttps ?? false,
        verifyUpstreamTls:
            proxyHost?.forwardScheme === 'https' ? (proxyHost.verifyUpstreamTls ?? true) : true,
        upstreamTlsServerName: proxyHost?.upstreamTlsServerName ?? null,
        trustedCaId: proxyHost?.trustedCaId ?? null,
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
        if (pendingDisableValues)
            await mutation.mutateAsync(pendingDisableValues).catch(() => undefined)
    }, [mutation, pendingDisableValues])
    return {
        state: {
            canAssignCertificates,
            canChangeEnabled: mode === 'create' || (proxyHost?.enabled ? canDisable : canEnable),
            assignableCertificates: certificatesQuery.data ?? [],
            assignableTrustedCas: trustedCasQuery.data ?? [],
            trustedCasLoadFailed: trustedCasQuery.isError,
            trustedCasLoading: trustedCasQuery.isPending,
            disableConfirmationOpen: pendingDisableValues !== null,
            domainKeys,
            form,
            isPending: mutation.isPending,
        },
        handler: { addDomain, removeDomain, confirmDisable, setDisableConfirmationOpen },
    }
}
