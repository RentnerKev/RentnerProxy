import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import type { AccessPolicyFormModalProps } from './Types/access-policy-form.types.ts'
import useAccessPolicyFormModalLogic from './Hooks/useAccessPolicyFormModalLogic.ts'
import AccessPolicyFormFields from './Components/AccessPolicyFormFields.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function AccessPolicyFormModal(props: AccessPolicyFormModalProps) {
    const { state, handler } = useAccessPolicyFormModalLogic(props)
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
                        className={buttonClassName('secondary')}
                        disabled={state.isPending}
                        onClick={() => props.onOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        className={buttonClassName('primary')}
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
                    basicAuthAccountCount={props.policy ? props.policy.basicAuthAccountCount : 0}
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
                    setBasicAuthUsername={handler.setBasicAuthUsername}
                    setBasicAuthPassword={handler.setBasicAuthPassword}
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
