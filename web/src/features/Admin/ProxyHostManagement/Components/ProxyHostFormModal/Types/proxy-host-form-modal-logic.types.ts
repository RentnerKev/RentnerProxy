import type { RefObject } from 'react'
import type { ProxyHostFormModalProps } from './proxy-host-form.types.ts'

export interface ProxyHostFormModalRefs {
    readonly guideHeading: RefObject<HTMLHeadingElement | null>
}

export type UseProxyHostFormLogicParams = Pick<
    ProxyHostFormModalProps,
    | 'initialGuideOpen'
    | 'canConfigureCompression'
    | 'canConfigureBrowserCache'
    | 'canEnable'
    | 'canDisable'
    | 'canAssignCertificates'
    | 'canRequestCertificate'
    | 'canAssignPolicies'
    | 'canApplyResponseCache'
    | 'mode'
    | 'onSuccess'
    | 'proxyHost'
>
