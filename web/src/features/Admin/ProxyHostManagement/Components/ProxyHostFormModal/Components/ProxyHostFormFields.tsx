import useProxyHostFormFieldsLogic from '../Hooks/useProxyHostFormFieldsLogic.ts'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types.ts'
import ProxyHostFormPanel from './ProxyHostFormPanel.tsx'
import ProxyHostBaseFields from './ProxyHostBaseFields.tsx'
import ProxyHostCertificateFields from './ProxyHostCertificateFields.tsx'
import ProxyHostAccessFields from './ProxyHostAccessFields.tsx'
import ProxyHostCacheFields from './ProxyHostCacheFields.tsx'
import ProxyHostOptionsFields from './ProxyHostOptionsFields.tsx'

export default function ProxyHostFormFields(props: ProxyHostFormFieldsProps) {
    const { activeTab, form, formId, isPending } = props
    const { state, handler } = useProxyHostFormFieldsLogic(props)
    return (
        <>
            <ProxyHostFormPanel activeTab={activeTab} tab="general" formId={formId}>
                <ProxyHostBaseFields
                    form={form}
                    formId={formId}
                    isPending={isPending}
                    domainKeys={props.domainKeys}
                    addDomain={props.addDomain}
                    removeDomain={props.removeDomain}
                    onSchemeChange={handler.handleSchemeChange}
                />
            </ProxyHostFormPanel>
            <ProxyHostFormPanel activeTab={activeTab} tab="certificate" formId={formId}>
                <ProxyHostCertificateFields
                    form={form}
                    formId={formId}
                    isPending={isPending}
                    canAssignCertificates={props.canAssignCertificates}
                    canRequestCertificate={props.canRequestCertificate}
                    assignableCertificatesLoading={props.assignableCertificatesLoading}
                    assignableCertificatesLoadFailed={props.assignableCertificatesLoadFailed}
                    retryAssignableCertificates={props.retryAssignableCertificates}
                    requestNewCertificate={props.requestNewCertificate}
                    certificateRequestForm={props.certificateRequestForm}
                    usableCertificates={state.usableCertificates}
                    usable={state.usable}
                    onCertificateChange={handler.handleCertificateChange}
                />
            </ProxyHostFormPanel>
            <ProxyHostFormPanel activeTab={activeTab} tab="access" formId={formId}>
                <ProxyHostAccessFields
                    form={form}
                    formId={formId}
                    isPending={isPending}
                    canAssignPolicies={props.canAssignPolicies}
                    assignableAccessPolicies={props.assignableAccessPolicies}
                    assignableAccessPoliciesLoading={props.assignableAccessPoliciesLoading}
                    assignableAccessPoliciesLoadFailed={props.assignableAccessPoliciesLoadFailed}
                    retryAssignableAccessPolicies={props.retryAssignableAccessPolicies}
                    assignableTrustedCas={props.assignableTrustedCas}
                    trustedCasLoading={props.trustedCasLoading}
                    trustedCasLoadFailed={props.trustedCasLoadFailed}
                    availability={state.availability}
                />
            </ProxyHostFormPanel>
            <ProxyHostFormPanel activeTab={activeTab} tab="caching" formId={formId}>
                <ProxyHostCacheFields
                    form={form}
                    formId={formId}
                    isPending={isPending}
                    canConfigureCompression={props.canConfigureCompression}
                    canConfigureBrowserCache={props.canConfigureBrowserCache}
                    canApplyResponseCache={props.canApplyResponseCache}
                    handleBrowserCacheChange={props.handleBrowserCacheChange}
                />
            </ProxyHostFormPanel>
            <ProxyHostFormPanel activeTab={activeTab} tab="options" formId={formId}>
                <ProxyHostOptionsFields
                    form={form}
                    formId={formId}
                    isPending={isPending}
                    canChangeEnabled={props.canChangeEnabled}
                />
            </ProxyHostFormPanel>
        </>
    )
}
