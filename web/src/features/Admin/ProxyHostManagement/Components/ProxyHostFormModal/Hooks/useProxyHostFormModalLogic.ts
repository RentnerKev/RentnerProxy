import useHostDomainList from '@/shared/HostDomains/Hooks/useHostDomainList.ts'
import type {
    ProxyHostFormModalRefs,
    UseProxyHostFormLogicParams,
} from '../Types/proxy-host-form-modal-logic.types.ts'
import { invalidateAccessPoliciesCache } from '@/lib/Admin/AccessPolicyManagement/accessPolicyManagementCache.ts'
import type {
    ProxyHostFormModalHandler,
    ProxyHostFormModalState,
    ProxyHostFormTab,
} from '../Types/proxy-host-form.types.ts'

import { invalidateTrustedCaManagementCache } from '@/lib/Admin/TrustedCaManagement/trustedCaManagementCache.ts'
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
import { MAX_PROXY_HOST_DOMAINS, PROXY_HOST_FORM_TABS } from '@/config/proxy-hosts.config.ts'
import { toast } from '@rentnerkev/toasts'
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
    canConfigureCompression = false,
    canConfigureBrowserCache = false,
    canEnable,
    canDisable,
    canAssignCertificates = false,
    canRequestCertificate = false,
    canAssignPolicies = false,
    canApplyResponseCache = false,
    mode,
    onSuccess,
    proxyHost,
}: UseProxyHostFormLogicParams) {
    const { t } = useTranslationStore()
    const formId = useId()
    const [selectedTab, setSelectedTab] = useState<ProxyHostFormTab>('general')
    const [validationAttempt, setValidationAttempt] = useState(0)
    const validationFocusPending = useRef(false)
    const revealInvalidTab = useCallback((tab: ProxyHostFormTab) => {
        validationFocusPending.current = true
        setSelectedTab(tab)
        setValidationAttempt((attempt) => attempt + 1)
    }, [])
    const [guideOpen, setGuideOpen] = useState(initialGuideOpen)
    const [guideStep, setGuideStep] = useState(0)
    const guideHeading = useRef<HTMLHeadingElement>(null)
    const previousGuideStateRef = useRef({ open: false, step: guideStep })
    useEffect(() => {
        const formElement = document.getElementById(formId)
        formElement?.closest('[role="dialog"]')?.scrollTo({ top: 0 })
        const previous = previousGuideStateRef.current
        previousGuideStateRef.current = { open: guideOpen, step: guideStep }
        if (!guideOpen || (previous.open && previous.step === guideStep)) return
        guideHeading.current?.focus({ preventScroll: true })
        formElement?.parentElement?.scrollTo({ top: 0 })
    }, [formId, guideOpen, guideStep])
    const handleToggleGuide = useCallback(() => {
        setGuideOpen((open) => !open)
        if (!guideOpen)
            setSelectedTab(
                guideStep === 2 && (canAssignCertificates || canRequestCertificate)
                    ? 'certificate'
                    : 'general',
            )
    }, [guideOpen, guideStep, canAssignCertificates, canRequestCertificate])
    const handleNextGuideStep = useCallback(() => {
        const next = Math.min(2, guideStep + 1)
        setGuideStep(next)
        setSelectedTab(
            next === 2 && (canAssignCertificates || canRequestCertificate)
                ? 'certificate'
                : 'general',
        )
    }, [guideStep, canAssignCertificates, canRequestCertificate])
    const handlePreviousGuideStep = useCallback(() => {
        setGuideStep((step) => Math.max(0, step - 1))
        setSelectedTab('general')
    }, [])
    const isCreate = mode !== 'edit'
    const defaultValues = getProxyHostFormValues(mode, proxyHost)
    const queryClient = useQueryClient()
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
            const submittedData = { ...data }
            if (!canAssignPolicies) delete submittedData.accessPolicyId
            if (!canConfigureBrowserCache) delete submittedData.browserCache
            if (!canConfigureCompression) delete submittedData.responseCompression
            if (
                !canApplyResponseCache ||
                (submittedData.responseCache === null && !proxyHost?.responseCache)
            )
                delete submittedData.responseCache
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
                }),
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
        onError: (error) =>
            toast.error(
                t(
                    error instanceof Error &&
                        error.message === 'admin.dnsConnections.providers.unavailable'
                        ? error.message
                        : 'admin.proxyHosts.errors.saveFailed',
                ),
                { title: t('toast.titles.error') },
            ),
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
                if (Object.keys(errors).length > 0) {
                    certificateRequest.reportValidationError(certificateRequest.form.state.values)
                    revealInvalidTab('certificate')
                    return
                }
            }
            if (mode === 'edit' && proxyHost?.enabled && !value.enabled) {
                setPendingDisableValues({ ...value, domains: [...value.domains] })
                return
            }
            await mutation.mutateAsync(value).catch(() => undefined)
        },
        onSubmitInvalid: ({ formApi }) => {
            const invalidFields = Object.entries(formApi.state.fieldMeta)
                .filter(([, meta]) => (meta?.errors.length ?? 0) > 0)
                .map(([name]) => name)
            const tab = PROXY_HOST_FORM_TABS.find(({ fields }) =>
                fields.some((field) =>
                    invalidFields.some(
                        (name) =>
                            name === field ||
                            name.startsWith(field + '.') ||
                            name.startsWith(field + '['),
                    ),
                ),
            )
            revealInvalidTab(tab?.id ?? 'general')
        },
    })
    const guideValues = useStore(form.store, (state) => state.values)
    const fieldMeta = useStore(form.store, (state) => state.fieldMeta)
    const certificateFieldMeta = useStore(certificateRequest.form.store, (state) => state.fieldMeta)
    const invalidFields = Object.entries(fieldMeta)
        .filter(([, meta]) => (meta?.errors.length ?? 0) > 0)
        .map(([name]) => name)
    const invalidTabs: ProxyHostFormTab[] = PROXY_HOST_FORM_TABS.filter(({ fields }) =>
        fields.some((field) =>
            invalidFields.some(
                (name) =>
                    name === field || name.startsWith(field + '.') || name.startsWith(field + '['),
            ),
        ),
    ).map(({ id }) => id)
    if (
        requestNewCertificate &&
        Object.values(certificateFieldMeta).some((meta) => (meta?.errors.length ?? 0) > 0) &&
        !invalidTabs.includes('certificate')
    )
        invalidTabs.push('certificate')
    const tabs = PROXY_HOST_FORM_TABS.filter(
        ({ id }) =>
            (id !== 'certificate' || canAssignCertificates || canRequestCertificate) &&
            (id !== 'access' || canAssignPolicies || guideValues.forwardScheme === 'https'),
    ).map(({ id }) => id)
    const activeTab = tabs.includes(selectedTab) ? selectedTab : 'general'
    useEffect(() => {
        const element = document.getElementById(formId)
        element?.parentElement?.scrollTo({ top: 0 })
        if (!validationAttempt || !validationFocusPending.current) return
        const panel = document.getElementById(`${formId}-panel-${activeTab}`)
        const invalid = panel?.querySelector<HTMLElement>('[aria-invalid="true"]')
        const target = invalid ?? panel
        target?.focus({ preventScroll: true })
        invalid?.scrollIntoView({ block: 'nearest' })
        validationFocusPending.current = false
    }, [formId, activeTab, validationAttempt])
    const handleTabKeyDown: ProxyHostFormModalHandler['handleTabKeyDown'] = (event, tab) => {
        const index = tabs.indexOf(tab)
        const nextIndex =
            event.key === 'ArrowRight'
                ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft'
                  ? (index - 1 + tabs.length) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : null
        if (nextIndex === null) return
        event.preventDefault()
        const next = tabs[nextIndex]!
        setSelectedTab(next)
        document.getElementById(`${formId}-tab-${next}`)?.focus({ preventScroll: true })
    }
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
    const { state: domainState, handler: domainHandler } = useHostDomainList({
        initialDomains: defaultValues.domains,
        maxDomains: MAX_PROXY_HOST_DOMAINS,
        isPending: mutation.isPending,
        form,
    })
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
            if (requestNewCertificate) certificateRequest.form.setFieldValue('acceptTerms', true)
            void form.handleSubmit()
        },
        [form, certificateRequest.form, requestNewCertificate],
    )
    const handleBrowserCacheChange = useCallback<
        ProxyHostFormModalHandler['handleBrowserCacheChange']
    >(
        (settings) => {
            if (!canConfigureBrowserCache || mutation.isPending) return
            form.setFieldValue('browserCache', settings)
            if (form.state.submissionAttempts > 0) void form.validate('submit')
        },
        [canConfigureBrowserCache, form, mutation.isPending],
    )

    return {
        refs: { guideHeading } satisfies ProxyHostFormModalRefs,
        form,
        certificateRequestForm: certificateRequest.form,
        state: {
            activeTab,
            tabs,
            invalidTabs,
            canConfigureBrowserCache,
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
            pendingSubmitLabel: t('common.saving'),
            submitLabel: requestNewCertificate
                ? t('admin.proxyHosts.form.requestCertificateAndSave')
                : t('common.save'),

            canConfigureCompression,
            canAssignCertificates,
            canRequestCertificate,
            canAssignPolicies,
            canApplyResponseCache,
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
            domainKeys: domainState.domainKeys,
            requestNewCertificate,
            isPending: mutation.isPending,
        } satisfies Omit<ProxyHostFormModalState, 'form' | 'certificateRequestForm'>,
        handler: {
            setActiveTab: setSelectedTab,
            handleTabKeyDown,
            handleBrowserCacheChange,
            handleToggleGuide,
            handleNextGuideStep,
            handlePreviousGuideStep,
            handleSubmit,
            addDomain: domainHandler.addDomain,
            removeDomain: domainHandler.removeDomain,
            retryAssignableCertificates,
            retryAssignableAccessPolicies,
            confirmDisable,
            setDisableConfirmationOpen,
            setRequestNewCertificate: (request) => {
                certificateRequest.form.setFieldValue('acceptTerms', false)
                setRequestNewCertificate(request)
            },
        } satisfies ProxyHostFormModalHandler,
    }
}
