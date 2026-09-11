import { useCallback, useId } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type {
    AccessPolicyFormModalHandler,
    AccessPolicyFormModalProps,
    AccessPolicyFormModalState,
} from '../Types/access-policy-form.types'
import useAccessPolicyFormLogic from './useAccessPolicyFormLogic'

export default function useAccessPolicyFormModal(props: AccessPolicyFormModalProps): {
    readonly state: AccessPolicyFormModalState
    readonly handler: AccessPolicyFormModalHandler
} {
    const formId = useId()
    const { t } = useTranslationStore()
    const form = useAccessPolicyFormLogic(props)
    const handleSubmit = useCallback<AccessPolicyFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handler.submit()
        },
        [form.handler],
    )
    const isCreate = props.mode === 'create'

    return {
        state: {
            ...form.state,
            description: t('admin.accessPolicies.form.description'),
            formId,
            pendingSubmitLabel: t(
                isCreate ? 'admin.accessPolicies.form.creating' : 'common.saving',
            ),
            submitLabel: t(isCreate ? 'admin.accessPolicies.actions.create' : 'common.save'),
            title: t(
                isCreate
                    ? 'admin.accessPolicies.actions.add'
                    : 'admin.accessPolicies.form.editTitle',
            ),
        },
        handler: {
            handleSubmit,
            setCombination: form.handler.setCombination,
            setMode: form.handler.setMode,
            setName: form.handler.setName,
        },
    }
}
