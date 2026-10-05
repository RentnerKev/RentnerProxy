import type { FormEventHandler, RefObject } from 'react'
import type { z } from 'zod'

import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import type { CertificateSummary } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import type useCertificateRequest from '@/features/Admin/CertificateManagement/Hooks/useCertificateRequest.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type useProxyHostFormModalLogic from '../Hooks/useProxyHostFormModalLogic.ts'
import type { proxyHostFormSchema } from '../../../validation.ts'

export type ProxyHostEditorFormValues = z.input<typeof proxyHostFormSchema>
type ProxyHostFormInstance = ReturnType<typeof useProxyHostFormModalLogic>['form']

export interface ProxyHostFormModalProps {
    readonly initialGuideOpen?: boolean
    readonly canEnable: boolean
    readonly canDisable: boolean
    readonly canAssignCertificates?: boolean
    readonly canRequestCertificate?: boolean
    readonly canAssignPolicies?: boolean
    readonly mode: 'create' | 'edit' | 'duplicate'
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void
    readonly open: boolean
    readonly proxyHost?: ProxyHostSummary | undefined
}

export interface ProxyHostSetupGuideState {
    readonly open: boolean
    readonly step: number
    readonly domains: string
    readonly upstream: string
    readonly wildcard: boolean
    readonly certificateSource: 'manual' | 'acme' | null
    readonly certificateSelected: boolean
    readonly certificateName: string | null
    readonly requestNewCertificate: boolean
    readonly challengeType: string
}

export interface ProxyHostFormModalState {
    readonly guide: ProxyHostSetupGuideState
    readonly canAssignCertificates: boolean
    readonly canRequestCertificate: boolean
    readonly canAssignPolicies: boolean
    readonly assignableAccessPolicies: readonly AccessPolicySummary[]
    readonly assignableAccessPoliciesLoadFailed: boolean
    readonly assignableAccessPoliciesLoading: boolean
    readonly assignableCertificates: readonly CertificateSummary[]
    readonly assignableCertificatesLoadFailed: boolean
    readonly assignableCertificatesLoading: boolean
    readonly assignableTrustedCas: ReadonlyArray<{ readonly id: string; readonly name: string }>
    readonly trustedCasLoadFailed: boolean
    readonly trustedCasLoading: boolean
    readonly canChangeEnabled: boolean
    readonly description: string
    readonly disableConfirmationOpen: boolean
    readonly domainKeys: readonly string[]
    readonly form: ProxyHostFormInstance
    readonly certificateRequestForm: ReturnType<typeof useCertificateRequest>['form']
    readonly requestNewCertificate: boolean
    readonly formId: string
    readonly isPending: boolean
    readonly pendingSubmitLabel: string
    readonly submitLabel: string
    readonly title: string
}

export interface ProxyHostFormModalHandler {
    readonly toggleGuide: () => void
    readonly nextGuideStep: () => void
    readonly previousGuideStep: () => void
    readonly addDomain: () => void
    readonly removeDomain: (index: number) => void
    readonly retryAssignableCertificates: () => void
    readonly retryAssignableAccessPolicies: () => void
    readonly handleSubmit: FormEventHandler<HTMLFormElement>
    readonly confirmDisable: () => Promise<void>
    readonly setDisableConfirmationOpen: (open: boolean) => void
    readonly setRequestNewCertificate: (request: boolean) => void
}

export type ProxyHostFormFieldsProps = Pick<
    ProxyHostFormModalState,
    | 'canChangeEnabled'
    | 'canAssignCertificates'
    | 'canRequestCertificate'
    | 'canAssignPolicies'
    | 'assignableAccessPolicies'
    | 'assignableAccessPoliciesLoadFailed'
    | 'assignableAccessPoliciesLoading'
    | 'assignableCertificates'
    | 'assignableCertificatesLoadFailed'
    | 'assignableCertificatesLoading'
    | 'assignableTrustedCas'
    | 'trustedCasLoadFailed'
    | 'trustedCasLoading'
    | 'domainKeys'
    | 'form'
    | 'certificateRequestForm'
    | 'requestNewCertificate'
    | 'formId'
    | 'isPending'
> &
    Pick<
        ProxyHostFormModalHandler,
        | 'addDomain'
        | 'removeDomain'
        | 'retryAssignableCertificates'
        | 'retryAssignableAccessPolicies'
        | 'setRequestNewCertificate'
    >

export type ProxyHostFormModalFooterProps = Pick<
    ProxyHostFormModalState,
    'form' | 'formId' | 'isPending' | 'pendingSubmitLabel' | 'submitLabel'
> &
    Pick<ProxyHostFormModalProps, 'onOpenChange'>

export type ProxyHostSetupGuideProps = Pick<
    ProxyHostFormModalHandler,
    'toggleGuide' | 'nextGuideStep' | 'previousGuideStep'
> & {
    readonly guide: ProxyHostSetupGuideState
    readonly guideHeading: RefObject<HTMLHeadingElement | null>
    readonly formId: string
}
