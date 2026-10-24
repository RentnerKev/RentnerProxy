import type { ReactNode } from 'react'
import type { ProxyHostFormFieldsLogicResult } from './form-fields-logic.types.ts'
import type {
    ProxyHostFormFieldsProps,
    ProxyHostFormModalHandler,
    ProxyHostFormModalState,
    ProxyHostFormTab,
} from './proxy-host-form.types.ts'

export type ProxyHostBaseFieldsProps = Pick<
    ProxyHostFormFieldsProps,
    'form' | 'formId' | 'isPending' | 'domainKeys' | 'addDomain' | 'removeDomain'
> & { readonly onSchemeChange: ProxyHostFormFieldsLogicResult['handler']['handleSchemeChange'] }

export type ProxyHostCertificateFieldsProps = Pick<
    ProxyHostFormFieldsProps,
    | 'form'
    | 'formId'
    | 'isPending'
    | 'canAssignCertificates'
    | 'canRequestCertificate'
    | 'assignableCertificatesLoading'
    | 'assignableCertificatesLoadFailed'
    | 'retryAssignableCertificates'
    | 'requestNewCertificate'
    | 'certificateRequestForm'
> &
    Pick<ProxyHostFormFieldsLogicResult['state'], 'usableCertificates' | 'usable'> & {
        readonly onCertificateChange: ProxyHostFormFieldsLogicResult['handler']['handleCertificateChange']
    }

export type ProxyHostAccessFieldsProps = Pick<
    ProxyHostFormFieldsProps,
    | 'form'
    | 'formId'
    | 'isPending'
    | 'canAssignPolicies'
    | 'assignableAccessPolicies'
    | 'assignableAccessPoliciesLoading'
    | 'assignableAccessPoliciesLoadFailed'
    | 'retryAssignableAccessPolicies'
    | 'assignableTrustedCas'
    | 'trustedCasLoading'
    | 'trustedCasLoadFailed'
> &
    Pick<ProxyHostFormFieldsLogicResult['state'], 'availability'>

export type ProxyHostCacheFieldsProps = Pick<
    ProxyHostFormFieldsProps,
    | 'form'
    | 'formId'
    | 'isPending'
    | 'canConfigureCompression'
    | 'canConfigureBrowserCache'
    | 'canApplyResponseCache'
    | 'handleBrowserCacheChange'
>

export type ProxyHostOptionsFieldsProps = Pick<
    ProxyHostFormFieldsProps,
    'form' | 'formId' | 'isPending' | 'canChangeEnabled'
>

export interface ProxyHostFormPanelProps {
    readonly activeTab: ProxyHostFormTab
    readonly tab: ProxyHostFormTab
    readonly formId: string
    readonly children: ReactNode
}

export type ProxyHostFormTabsProps = Pick<
    ProxyHostFormModalState,
    'activeTab' | 'formId' | 'tabs' | 'isPending' | 'invalidTabs'
> &
    Pick<ProxyHostFormModalHandler, 'setActiveTab' | 'handleTabKeyDown'>
