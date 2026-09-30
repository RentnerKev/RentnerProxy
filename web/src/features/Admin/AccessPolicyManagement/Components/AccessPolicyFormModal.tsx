import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import type { AccessPolicyFormModalProps } from '../Types/access-policy-form.types'
import { getBasicAuthAccountCount } from '../Helpers/basicAuthPolicyState'
import useAccessPolicyFormModal from '../Hooks/useAccessPolicyFormModal'
import AccessPolicyFormFields from './AccessPolicyFormFields'

export default function AccessPolicyFormModal(props: AccessPolicyFormModalProps) {
    const { state, handler } = useAccessPolicyFormModal(props)
    const { t } = useTranslationStore()

    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={state.title}
            description={state.description}
            size="md"
            closeDisabled={state.isPending}
            footer={
                <>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                        disabled={state.isPending}
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        disabled={state.isPending}
                    >
                        {state.isPending ? state.pendingSubmitLabel : state.submitLabel}
                    </button>
                </>
            }
        >
            <form
                id={state.formId}
                className="grid gap-4 shell:grid-cols-2 shell:items-start"
                noValidate
                onSubmit={handler.handleSubmit}
            >
                <AccessPolicyFormFields
                    basicAuthAccountCount={
                        props.policy ? getBasicAuthAccountCount(props.policy) : 0
                    }
                    errors={state.errors}
                    formId={state.formId}
                    isPending={state.isPending}
                    setCombination={handler.setCombination}
                    setIpRules={handler.setIpRules}
                    setIpRuleAllow={handler.setIpRuleAllow}
                    setIpRuleDefaultAction={handler.setIpRuleDefaultAction}
                    setIpRuleDeny={handler.setIpRuleDeny}
                    setMode={handler.setMode}
                    setName={handler.setName}
                    setAuthMethod={handler.setAuthMethod}
                    setForwardAuthProvider={handler.setForwardAuthProvider}
                    setForwardAuthEndpoint={handler.setForwardAuthEndpoint}
                    setForwardAuthGatewayPathPrefix={handler.setForwardAuthGatewayPathPrefix}
                    setForwardAuthTimeout={handler.setForwardAuthTimeout}
                    setForwardAuthRequestHeader={handler.setForwardAuthRequestHeader}
                    setForwardAuthResponseHeaders={handler.setForwardAuthResponseHeaders}
                    values={state.values}
                />
            </form>
        </Modal>
    )
}
