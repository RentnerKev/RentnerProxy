import { useCallback, useId } from 'react'
import useTranslationStore from '../../../../language/useTranslationStore'
import type {
    RedirectHostFormModalHandler,
    RedirectHostFormModalProps,
    RedirectHostFormModalState,
} from '../Types/redirect-host-form.types'
import useRedirectHostFormLogic from './useRedirectHostFormLogic'
export default function useRedirectHostFormModal(props: RedirectHostFormModalProps): {
    readonly state: RedirectHostFormModalState
    readonly handler: RedirectHostFormModalHandler
} {
    const formId = useId()
    const { t } = useTranslationStore()
    const isCreate = props.mode === 'create'
    const { state, handler } = useRedirectHostFormLogic(props)
    const handleSubmit = useCallback<RedirectHostFormModalHandler['handleSubmit']>(
        (event) => {
            event.preventDefault()
            event.stopPropagation()
            void state.form.handleSubmit()
        },
        [state.form],
    )
    return {
        state: {
            ...state,
            formId,
            description: t('admin.redirectHosts.form.description'),
            title: t(
                isCreate ? 'admin.redirectHosts.actions.add' : 'admin.redirectHosts.form.editTitle',
            ),
            pendingSubmitLabel: t(isCreate ? 'admin.redirectHosts.form.creating' : 'common.saving'),
            submitLabel: t(isCreate ? 'admin.redirectHosts.actions.create' : 'common.save'),
        },
        handler: { ...handler, handleSubmit },
    }
}
