import type { FormEventHandler } from 'react'
import type { z } from 'zod'

import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'
import type useProxyHostFormLogic from '../Hooks/useProxyHostFormLogic'
import type { proxyHostFormSchema } from '../validation'

export type ProxyHostEditorFormValues = z.input<typeof proxyHostFormSchema>
export type ProxyHostFormInstance = ReturnType<typeof useProxyHostFormLogic>['state']['form']

export interface ProxyHostFormModalProps {
    readonly canEnable: boolean
    readonly canDisable: boolean
    readonly canAssignCertificates?: boolean
    readonly canAssignPolicies?: boolean
    readonly mode: 'create' | 'edit'
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void
    readonly open: boolean
    readonly proxyHost?: ProxyHostSummary | undefined
}

export interface ProxyHostFormModalState {
    readonly canAssignCertificates: boolean
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
    readonly formId: string
    readonly isPending: boolean
    readonly pendingSubmitLabel: string
    readonly submitLabel: string
    readonly title: string
}

export interface ProxyHostFormModalHandler {
    readonly addDomain: () => void
    readonly removeDomain: (index: number) => void
    readonly retryAssignableCertificates: () => void
    readonly retryAssignableAccessPolicies: () => void
    readonly handleSubmit: FormEventHandler<HTMLFormElement>
    readonly confirmDisable: () => Promise<void>
    readonly setDisableConfirmationOpen: (open: boolean) => void
}

export type ProxyHostFormFieldsProps = Pick<
    ProxyHostFormModalState,
    | 'canChangeEnabled'
    | 'canAssignCertificates'
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
    | 'formId'
    | 'isPending'
> &
    Pick<
        ProxyHostFormModalHandler,
        | 'addDomain'
        | 'removeDomain'
        | 'retryAssignableCertificates'
        | 'retryAssignableAccessPolicies'
    >

export type ProxyHostFormModalFooterProps = Pick<
    ProxyHostFormModalState,
    'form' | 'formId' | 'isPending' | 'pendingSubmitLabel' | 'submitLabel'
> &
    Pick<ProxyHostFormModalProps, 'onOpenChange'>
