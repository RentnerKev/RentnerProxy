import type { ProxyHostFormModalProps } from './proxy-host-form.types.ts'

export type UseProxyHostFormLogicParams = Pick<
    ProxyHostFormModalProps,
    | 'canEnable'
    | 'canDisable'
    | 'canAssignCertificates'
    | 'canRequestCertificate'
    | 'canAssignPolicies'
    | 'mode'
    | 'onSuccess'
    | 'proxyHost'
>
