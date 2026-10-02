import type { FormEventHandler } from 'react'
import type { z } from 'zod'
import type { CertificateSummary } from '@/shared/Types/certificates.types.ts'
import type { RedirectHostSummary } from '@/shared/Types/redirect-hosts.types.ts'
import type useRedirectHostFormModalLogic from '../Hooks/useRedirectHostFormModalLogic.ts'
import type { redirectHostFormSchema } from '../../../validation.ts'

export type RedirectHostEditorFormValues = z.input<typeof redirectHostFormSchema>
export type RedirectHostFormInstance = ReturnType<typeof useRedirectHostFormModalLogic>['form']
export interface RedirectHostFormModalProps {
    readonly canEnable: boolean
    readonly canDisable: boolean
    readonly canAssignCertificates?: boolean
    readonly mode: 'create' | 'edit'
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void
    readonly open: boolean
    readonly redirectHost?: RedirectHostSummary
}
export interface RedirectHostFormModalState {
    readonly canAssignCertificates: boolean
    readonly assignableCertificates: readonly CertificateSummary[]
    readonly assignableCertificatesLoadFailed: boolean
    readonly assignableCertificatesLoading: boolean
    readonly canChangeEnabled: boolean
    readonly description: string
    readonly disableConfirmationOpen: boolean
    readonly domainKeys: readonly string[]
    readonly form: RedirectHostFormInstance
    readonly formId: string
    readonly isPending: boolean
    readonly pendingSubmitLabel: string
    readonly submitLabel: string
    readonly title: string
}
export interface RedirectHostFormModalHandler {
    readonly addDomain: () => void
    readonly removeDomain: (index: number) => void
    readonly retryAssignableCertificates: () => void
    readonly handleSubmit: FormEventHandler<HTMLFormElement>
    readonly confirmDisable: () => Promise<void>
    readonly setDisableConfirmationOpen: (open: boolean) => void
}
export type RedirectHostFormFieldsProps = Pick<
    RedirectHostFormModalState,
    | 'canChangeEnabled'
    | 'canAssignCertificates'
    | 'assignableCertificates'
    | 'assignableCertificatesLoadFailed'
    | 'assignableCertificatesLoading'
    | 'domainKeys'
    | 'form'
    | 'formId'
    | 'isPending'
> &
    Pick<RedirectHostFormModalHandler, 'addDomain' | 'removeDomain' | 'retryAssignableCertificates'>
export type RedirectHostFormModalFooterProps = Pick<
    RedirectHostFormModalState,
    'form' | 'formId' | 'isPending' | 'pendingSubmitLabel' | 'submitLabel'
> &
    Pick<RedirectHostFormModalProps, 'onOpenChange'>

export interface RedirectHostFormModalLogicResult {
    readonly form: RedirectHostFormInstance
    readonly state: Omit<RedirectHostFormModalState, 'form'>
    readonly handler: RedirectHostFormModalHandler
}
