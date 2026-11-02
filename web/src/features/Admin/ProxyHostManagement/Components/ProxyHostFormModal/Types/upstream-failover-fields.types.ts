import type { ProxyHostEditorFormValues } from './proxy-host-form.types.ts'
import type { UpstreamPoolFieldsProps } from './upstream-pool-fields.types.ts'

export type UpstreamFailoverFormValue = NonNullable<
    NonNullable<ProxyHostEditorFormValues['upstreamPool']>['failover']
>
export type UpstreamFailoverFeature = keyof UpstreamFailoverFormValue
export type UpstreamFailoverNumberName =
    | `upstreamPool.failover.active.${Exclude<keyof NonNullable<UpstreamFailoverFormValue['active']>, 'path'>}`
    | `upstreamPool.failover.passive.${keyof NonNullable<UpstreamFailoverFormValue['passive']>}`
    | `upstreamPool.failover.retries.${keyof NonNullable<UpstreamFailoverFormValue['retries']>}`
export interface UpstreamFailoverNumberField {
    name: UpstreamFailoverNumberName
    label: string
    min: number
    max: number
    placeholder: string
}
export type UpstreamFailoverFieldsProps = UpstreamPoolFieldsProps
export interface UpstreamFailoverFieldsLogicResult {
    state: {
        sections: ReadonlyArray<{
            feature: UpstreamFailoverFeature
            enabled: boolean
            disabled: boolean
            fields: readonly UpstreamFailoverNumberField[]
        }>
    }
    handler: {
        handleToggle: (feature: UpstreamFailoverFeature, enabled: boolean) => void
        handleNumberChange: (name: UpstreamFailoverNumberName, value: string) => void
        handlePathChange: (value: string) => void
    }
}
