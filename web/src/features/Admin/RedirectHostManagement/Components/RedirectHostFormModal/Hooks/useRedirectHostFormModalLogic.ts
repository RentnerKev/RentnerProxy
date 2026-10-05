import type {
    RedirectHostFormModalHandler,
    RedirectHostFormModalProps,
    RedirectHostFormModalState,
} from '../Types/redirect-host-form.types.ts'

import { invalidateCertificateManagementAssignableCache } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useId, useState } from 'react'
import { MAX_REDIRECT_HOST_DOMAINS } from '@/config/redirect-hosts.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { certificateManagementQueryKeys } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import {
    getAssignableRedirectCertificatesHandler,
    createRedirectHostHandler,
    updateRedirectHostHandler,
} from '../../../middleware.ts'
import type { RedirectHostEditorFormValues } from '../Types/redirect-host-form.types.ts'
import { getRedirectHostFormDefaultValues } from '@/lib/Admin/RedirectHostManagement/redirectHostFormValues.ts'
import { redirectHostFormSchema } from '../../../validation.ts'
export default function useRedirectHostFormModalLogic({
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
    const { t } = useTranslationStore()
    const formId = useId()
    const isCreate = mode !== 'edit'
    const defaultValues = getRedirectHostFormDefaultValues(mode, redirectHost)
    const queryClient = useQueryClient()
    const [domainKeys, setDomainKeys] = useState(() =>
        defaultValues.domains.map(() => crypto.randomUUID()),
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
            return isCreate
                ? createRedirectHostHandler({ data })
                : redirectHost
                  ? updateRedirectHostHandler({
                        data: { ...data, redirectHostId: redirectHost.id },
                    })
                  : Promise.reject(new Error('admin.redirectHosts.errors.host_not_found'))
        },
        onSuccess: async (result) => {
            if (!result.success)
                return toast.error(t(result.message), { title: t('toast.titles.error') })
            await Promise.all([
                invalidateCertificateManagementAssignableCache(queryClient),
                queryClient.invalidateQueries({
                    queryKey: ['admin', 'redirect-hosts'],
                    exact: true,
                }),
                queryClient.invalidateQueries({
                    queryKey: ['admin', 'redirect-hosts', 'runtime-status'],
                }),
            ])
            if (result.runtimeStatus === 'pending')
                toast.warning(t('admin.redirectHosts.runtime.savedPending'), {
                    title: t('toast.titles.warning'),
                })
            else toast.success(t(result.message), { title: t('toast.titles.success') })
            setPendingDisableValues(null)
            onSuccess()
        },
        onError: () =>
            toast.error(t('admin.redirectHosts.errors.saveFailed'), {
                title: t('toast.titles.error'),
            }),
    })
    const retryAssignableCertificates = useCallback(() => {
        void certificatesQuery.refetch()
    }, [certificatesQuery])
    const form = useForm({
        defaultValues,
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
    const handleSubmit = useCallback<RedirectHostFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
        },
        [form],
    )
    return {
        form,
        state: {
            formId,
            description: t(
                mode === 'duplicate'
                    ? 'admin.redirectHosts.form.duplicateDescription'
                    : 'admin.redirectHosts.form.description',
            ),
            title: t(
                mode === 'duplicate'
                    ? 'admin.redirectHosts.actions.duplicate'
                    : isCreate
                      ? 'admin.redirectHosts.actions.add'
                      : 'admin.redirectHosts.form.editTitle',
            ),
            pendingSubmitLabel: t(isCreate ? 'admin.redirectHosts.form.creating' : 'common.saving'),
            submitLabel: t(isCreate ? 'admin.redirectHosts.actions.create' : 'common.save'),

            canAssignCertificates,
            canChangeEnabled: isCreate || (redirectHost?.enabled ? canDisable : canEnable),
            assignableCertificates: certificatesQuery.data ?? [],
            assignableCertificatesLoadFailed: certificatesQuery.isError,
            assignableCertificatesLoading: certificatesQuery.isPending,
            disableConfirmationOpen: pendingDisableValues !== null,
            domainKeys,
            isPending: mutation.isPending,
        } satisfies Omit<RedirectHostFormModalState, 'form'>,
        handler: {
            handleSubmit,
            addDomain,
            removeDomain,
            retryAssignableCertificates,
            confirmDisable: async () => {
                if (pendingDisableValues)
                    await mutation.mutateAsync(pendingDisableValues).catch(() => undefined)
            },
            setDisableConfirmationOpen: (open: boolean) => {
                if (!open) setPendingDisableValues(null)
            },
        } satisfies RedirectHostFormModalHandler,
    }
}
