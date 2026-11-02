import type {
    ProxyHostEditorFormValues,
    ProxyHostFormFieldsProps,
} from './proxy-host-form.types.ts'

export type UpstreamPoolFieldsProps = Pick<
    ProxyHostFormFieldsProps,
    'form' | 'formId' | 'isPending'
>
export type UpstreamPoolFormMember = NonNullable<
    ProxyHostEditorFormValues['upstreamPool']
>['members'][number]
export type UpstreamPoolEditorProps = UpstreamPoolFieldsProps & UpstreamPoolFieldsLogicResult
export interface UpstreamPoolFieldsLogicResult {
    state: {
        memberKeys: readonly string[]
        pool: ProxyHostEditorFormValues['upstreamPool']
        canAdd: boolean
    }
    handler: {
        handleModeChange: (value: string) => void
        handlePrimaryHostChange: (value: string) => void
        handlePrimaryPortChange: (value: string) => void
        handleMemberHostChange: (index: number, value: string) => void
        handleMemberPortChange: (index: number, value: string) => void
        handleAdd: () => void
        handleRemove: (index: number) => void
        handleMove: (index: number, direction: -1 | 1) => void
    }
}
