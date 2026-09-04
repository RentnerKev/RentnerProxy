import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { MAX_REDIRECT_HOST_DOMAINS } from '../../../../config/redirect-hosts.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { certificateManagementQueryKeys } from '../../CertificateManagement/queryKeys'
import {
    getAssignableRedirectCertificatesHandler,
    createRedirectHostHandler,
    updateRedirectHostHandler,
} from '../server'
import type {
    RedirectHostEditorFormValues,
    RedirectHostFormModalProps,
} from '../Types/redirect-host-form.types'
import { redirectHostFormSchema } from '../validation'
export default function useRedirectHostFormLogic({
    canEnable,
    canDisable,
    canAssignCertificates = false,
    mode,
    onSuccess,
    redirectHost,
}: Pick<
    RedirectHostFormModalProps,
    'canEnable' | 'canDisable' | 'canAssignCertificates' | 'mode' | 'onSuccess' | 'redirectHost'
>) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [domainKeys, setDomainKeys] = useState(() =>
        (redirectHost?.domains ?? ['']).map(() => crypto.randomUUID()),
    )
    const [pendingDisableValues, setPendingDisableValues] =
        useState<RedirectHostEditorFormValues | null>(null)
    const certificatesQuery = useQuery({
        queryKey: certificateManagementQueryKeys.assignable,
        queryFn: () => getAssignableRedirectCertificatesHandler(),
        enabled: canAssignCertificates,
        staleTime: 30_000,
    })
    const mutation = useMutation({
        mutationFn: (values: RedirectHostEditorFormValues) => {
            const data = redirectHostFormSchema.parse(values)
            return mode === 'create'
                ? createRedirectHostHandler({ data })
                : redirectHost
                  ? updateRedirectHostHandler({
                        data: { ...data, redirectHostId: redirectHost.id },
                    })
                  : Promise.reject(new Error('admin.redirectHosts.errors.host_not_found'))
        },
        onSuccess: async (result) => {
            if (!result.success) return toast.error(result.message)
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: certificateManagementQueryKeys.assignable,
                }),
                queryClient.invalidateQueries({
                    queryKey: ['admin', 'redirect-hosts'],
                    exact: true,
                }),
                queryClient.invalidateQueries({
                    queryKey: ['admin', 'redirect-hosts', 'runtime-status'],
                }),
            ])
            if (result.runtimeStatus === 'pending')
                toast.warning('admin.redirectHosts.runtime.savedPending')
            else toast.success(result.message)
            setPendingDisableValues(null)
            onSuccess()
        },
        onError: () => toast.error('admin.redirectHosts.errors.saveFailed'),
    })
    const form = useForm({
        defaultValues: {
            domains: redirectHost ? [...redirectHost.domains] : [''],
            destination: redirectHost?.destination ?? '',
            statusCode: String(redirectHost?.statusCode ?? 302),
            preserveRequestUri: redirectHost?.preserveRequestUri ?? true,
            enabled: redirectHost?.enabled ?? true,
            certificateId: redirectHost?.certificateId ?? null,
        },
        validators: { onSubmit: redirectHostFormSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()
            if (mode === 'edit' && redirectHost?.enabled && !value.enabled) {
                setPendingDisableValues({ ...value, domains: [...value.domains] })
                return
            }
            await mutation.mutateAsync(value).catch(() => undefined)
        },
    })
    const addDomain = useCallback(() => {
        if (form.state.values.domains.length >= MAX_REDIRECT_HOST_DOMAINS || mutation.isPending)
            return
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
    return {
        state: {
            canAssignCertificates,
            canChangeEnabled: mode === 'create' || (redirectHost?.enabled ? canDisable : canEnable),
            assignableCertificates: certificatesQuery.data ?? [],
            disableConfirmationOpen: pendingDisableValues !== null,
            domainKeys,
            form,
            isPending: mutation.isPending,
        },
        handler: {
            addDomain,
            removeDomain,
            confirmDisable: async () => {
                if (pendingDisableValues)
                    await mutation.mutateAsync(pendingDisableValues).catch(() => undefined)
            },
            setDisableConfirmationOpen: (open: boolean) => {
                if (!open) setPendingDisableValues(null)
            },
        },
    }
}
