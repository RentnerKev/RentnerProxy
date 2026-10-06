import type {
    ProxyHostFormModalRefs,
    UseProxyHostFormLogicParams,
} from '../Types/proxy-host-form-modal-logic.types.ts'
import { invalidateAccessPoliciesCache } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import type {
    ProxyHostFormModalHandler,
    ProxyHostFormModalState,
} from '../Types/proxy-host-form.types.ts'

import { invalidateTrustedCaManagementCache } from '@/lib/Admin/TrustedCaManagement/trustedCaManagementCache.ts'
import { invalidateProxyHostManagementRuntimeStatusCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { invalidateCertificateManagementAssignableCache } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import { useForm, useStore } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { accessPolicyManagementQueryKeys } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import { getAssignableAccessPoliciesHandler } from '@/features/Admin/AccessPolicyManagement/middleware.ts'
import { trustedCaManagementQueryKeys } from '@/lib/Admin/TrustedCaManagement/trustedCaManagementCache.ts'
import { getAssignableTrustedCasHandler } from '@/features/Admin/TrustedCaManagement/middleware.ts'
import { certificateManagementQueryKeys } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import { getAssignableCertificatesHandler } from '@/features/Admin/CertificateManagement/middleware.ts'
import { MAX_PROXY_HOST_DOMAINS } from '@/config/proxy-hosts.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { proxyHostManagementQueryKeys } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import {
    createProxyHostWithCertificateHandler,
    updateProxyHostWithCertificateHandler,
} from '../../../CertificateJobs/middleware.ts'
import { publishCertificateJobProgress } from '@/lib/Admin/ProxyHostManagement/CertificateJobs/certificateJobsCache.ts'
import useCertificateRequest from '@/features/Admin/CertificateManagement/Hooks/useCertificateRequest.ts'
import { hostCertificateRequestSchema } from '../../../certificate-job-validation.ts'
import { createProxyHostHandler, updateProxyHostHandler } from '../../../middleware.ts'
import type { ProxyHostEditorFormValues } from '../Types/proxy-host-form.types.ts'
import type { ProxyHostActionResult } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import type { CertificateJobActionResult } from '@/lib/CertificateJobs/Types/certificate-jobs.types.ts'
import { proxyHostFormSchema } from '../../../validation.ts'
import { getProxyHostFormValues } from '@/lib/Admin/ProxyHostManagement/proxyHostFormValues.ts'

export default function useProxyHostFormModalLogic({
    initialGuideOpen = false,
    canEnable,
    canDisable,
    canAssignCertificates = false,
    canRequestCertificate = false,
    canAssignPolicies = false,
    mode,
    onSuccess,
    proxyHost,
}: UseProxyHostFormLogicParams) {
    const { t } = useTranslationStore()
    const formId = useId()
    const [guideOpen, setGuideOpen] = useState(initialGuideOpen)
    const [guideStep, setGuideStep] = useState(0)
    const guideHeading = useRef<HTMLHeadingElement>(null)
    const previousGuideStepRef = useRef(guideStep)
    useEffect(() => {
        if (previousGuideStepRef.current !== guideStep) {
            previousGuideStepRef.current = guideStep
            guideHeading.current?.focus()
        }
    }, [guideStep])
    const handleToggleGuide = useCallback(() => setGuideOpen((open) => !open), [])
    const handleNextGuideStep = useCallback(() => setGuideStep((step) => Math.min(2, step + 1)), [])
    const handlePreviousGuideStep = useCallback(
        () => setGuideStep((step) => Math.max(0, step - 1)),
        [],
    )
    const isCreate = mode !== 'edit'
    const defaultValues = getProxyHostFormValues(mode, proxyHost)
    const queryClient = useQueryClient()
    const [domainKeys, setDomainKeys] = useState(() =>
        defaultValues.domains.map(() => crypto.randomUUID()),
    )
    const [pendingDisableValues, setPendingDisableValues] =
        useState<ProxyHostEditorFormValues | null>(null)
    const [requestNewCertificate, setRequestNewCertificate] = useState(false)
    const [certificateJobIdempotencyKey] = useState(() => crypto.randomUUID())
    const suggestedRequestName = useRef(defaultValues.domains[0] ?? '')
    const certificateRequest = useCertificateRequest({
        initialDomains: defaultValues.domains,
        initialName: defaultValues.domains[0] ?? '',
        onSuccess: async () => undefined,
        readOnlyDomains: true,
    })
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
    const accessPoliciesQuery = useQuery({
        queryKey: accessPolicyManagementQueryKeys.assignable,
        queryFn: () => getAssignableAccessPoliciesHandler(),
        enabled: canAssignPolicies,
        staleTime: 30_000,
    })
    const mutation = useMutation<
        ProxyHostActionResult | CertificateJobActionResult,
        Error,
        ProxyHostEditorFormValues
    >({
        mutationFn: (values: ProxyHostEditorFormValues) => {
            const data = proxyHostFormSchema.parse(values)
            const submittedData = canAssignPolicies
                ? data
                : (() => {
                      const preserved = { ...data }
                      delete preserved.accessPolicyId
                      return preserved
                  })()
            const request = requestNewCertificate
                ? (() => {
                      const parsed = certificateRequest.getRequestInput({
                          ...certificateRequest.form.state.values,
                          domains: hostDomains,
                      })
                      const { domains: _domains, ...withoutDomains } = parsed
                      return hostCertificateRequestSchema.parse(withoutDomains)
                  })()
                : null
            if (isCreate && request) {
                return createProxyHostWithCertificateHandler({
                    data: {
                        idempotencyKey: certificateJobIdempotencyKey,
                        host: submittedData,
                        request,
                    },
                })
            }
            if (isCreate) return createProxyHostHandler({ data: submittedData })
            if (!proxyHost) throw new Error('admin.proxyHosts.errors.proxy_host_not_found')
            if (request) {
                return updateProxyHostWithCertificateHandler({
                    data: {
                        idempotencyKey: certificateJobIdempotencyKey,
                        host: { ...submittedData, proxyHostId: proxyHost.id },
                        request,
                    },
                })
            }
            return updateProxyHostHandler({
                data: { ...submittedData, proxyHostId: proxyHost.id },
            })
        },
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            if ('job' in result) {
                await publishCertificateJobProgress(queryClient, result.job)
            }
            const refresh = Promise.all([
                invalidateTrustedCaManagementCache(queryClient),
                queryClient.invalidateQueries({
                    queryKey: proxyHostManagementQueryKeys.all,
                    exact: true,
                }),
                invalidateProxyHostManagementRuntimeStatusCache(queryClient),
                invalidateCertificateManagementAssignableCache(queryClient),
                invalidateAccessPoliciesCache(queryClient),
            ])
            if ('job' in result) {
                setPendingDisableValues(null)
                onSuccess()
                void refresh.catch(() => undefined)
                return
            }
            await refresh
            if ('runtimeStatus' in result && result.runtimeStatus === 'pending')
                toast.warning(t('admin.proxyHosts.runtime.savedPending'), {
                    title: t('toast.titles.warning'),
                })
            else toast.success(t(result.message), { title: t('toast.titles.success') })
            setPendingDisableValues(null)
            onSuccess()
        },
        onError: () =>
            toast.error(t('admin.proxyHosts.errors.saveFailed'), {
                title: t('toast.titles.error'),
            }),
    })
    const retryAssignableCertificates = useCallback(() => {
        void certificatesQuery.refetch()
    }, [certificatesQuery])
    const retryAssignableAccessPolicies = useCallback(() => {
        void accessPoliciesQuery.refetch()
    }, [accessPoliciesQuery])
    const form = useForm({
        defaultValues,
        validators: { onSubmit: proxyHostFormSchema },
        onSubmit: async ({ value }) => {
            mutation.reset()
            if (requestNewCertificate) {
                const errors = await certificateRequest.form.validate('submit')
                if (Object.keys(errors).length > 0) return
            }
            if (mode === 'edit' && proxyHost?.enabled && !value.enabled) {
                setPendingDisableValues({ ...value, domains: [...value.domains] })
                return
            }
            await mutation.mutateAsync(value).catch(() => undefined)
        },
    })
    const guideValues = useStore(form.store, (state) => state.values)
    const challengeType = useStore(
        certificateRequest.form.store,
        (state) => state.values.challengeType,
    )
    const guideUpstreamHost =
        guideValues.forwardHost.includes(':') && !guideValues.forwardHost.startsWith('[')
            ? '[' + guideValues.forwardHost + ']'
            : guideValues.forwardHost
    const selectedCertificate = certificatesQuery.data?.find(
        (certificate) => certificate.id === guideValues.certificateId,
    )
    const hostDomains = useStore(form.store, (state) => state.values.domains)
    useEffect(() => {
        certificateRequest.form.setFieldValue('domains', [...hostDomains])
        const currentName = certificateRequest.form.getFieldValue('name')
        if (!currentName.trim() || currentName === suggestedRequestName.current) {
            const nextName = hostDomains[0] ?? ''
            certificateRequest.form.setFieldValue('name', nextName)
            suggestedRequestName.current = nextName
        }
    }, [certificateRequest.form, hostDomains])
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
    const handleSubmit = useCallback<ProxyHostFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
        },
        [form],
    )

    return {
        refs: { guideHeading } satisfies ProxyHostFormModalRefs,
        form,
        certificateRequestForm: certificateRequest.form,
        state: {
            guide: {
                open: guideOpen,
                step: guideStep,
                domains: guideValues.domains.filter((domain) => domain.trim()).join(', '),
                upstream:
                    guideValues.forwardScheme +
                    '://' +
                    guideUpstreamHost +
                    ':' +
                    guideValues.forwardPort,
                wildcard: guideValues.domains.some((domain) => domain.trim().startsWith('*.')),
                certificateSource: selectedCertificate?.source ?? null,
                certificateSelected: Boolean(guideValues.certificateId),
                certificateName: selectedCertificate?.name ?? null,
                requestNewCertificate,
                challengeType,
            },
            formId,
            description: t(
                mode === 'duplicate'
                    ? 'admin.proxyHosts.form.duplicateDescription'
                    : 'admin.proxyHosts.form.description',
            ),
            title: t(
                mode === 'duplicate'
                    ? 'admin.proxyHosts.actions.duplicate'
                    : isCreate
                      ? 'admin.proxyHosts.actions.add'
                      : 'admin.proxyHosts.form.editTitle',
            ),
            pendingSubmitLabel: t(isCreate ? 'admin.proxyHosts.form.creating' : 'common.saving'),
            submitLabel: requestNewCertificate
                ? t('admin.certificates.actions.request')
                : t(isCreate ? 'admin.proxyHosts.actions.create' : 'common.save'),

            canAssignCertificates,
            canRequestCertificate,
            canAssignPolicies,
            assignableAccessPolicies: accessPoliciesQuery.data ?? [],
            assignableAccessPoliciesLoadFailed: accessPoliciesQuery.isError,
            assignableAccessPoliciesLoading: accessPoliciesQuery.isPending,
            canChangeEnabled: isCreate || (proxyHost?.enabled ? canDisable : canEnable),
            assignableCertificates: certificatesQuery.data ?? [],
            assignableCertificatesLoadFailed: certificatesQuery.isError,
            assignableCertificatesLoading: certificatesQuery.isPending,
            assignableTrustedCas: trustedCasQuery.data ?? [],
            trustedCasLoadFailed: trustedCasQuery.isError,
            trustedCasLoading: trustedCasQuery.isPending,
            disableConfirmationOpen: pendingDisableValues !== null,
            domainKeys,
            requestNewCertificate,
            isPending: mutation.isPending,
        } satisfies Omit<ProxyHostFormModalState, 'form' | 'certificateRequestForm'>,
        handler: {
            handleToggleGuide,
            handleNextGuideStep,
            handlePreviousGuideStep,
            handleSubmit,
            addDomain,
            removeDomain,
            retryAssignableCertificates,
            retryAssignableAccessPolicies,
            confirmDisable,
            setDisableConfirmationOpen,
            setRequestNewCertificate,
        } satisfies ProxyHostFormModalHandler,
    }
}
