import { useCallback, useId } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import type {
    ProxyHostFormModalHandler,
    ProxyHostFormModalProps,
    ProxyHostFormModalState,
} from '../Types/proxy-host-form.types'
import useProxyHostFormLogic from './useProxyHostFormLogic'

export default function useProxyHostFormModal(props: ProxyHostFormModalProps): {
    readonly state: ProxyHostFormModalState
    readonly handler: ProxyHostFormModalHandler
} {
    const formId = useId()
    const { t } = useTranslationStore()
    const isCreate = props.mode === 'create'
    const { state, handler } = useProxyHostFormLogic(props)
    const handleSubmit = useCallback<ProxyHostFormModalHandler['handleSubmit']>(
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
            description: t('admin.proxyHosts.form.description'),
            title: t(isCreate ? 'admin.proxyHosts.actions.add' : 'admin.proxyHosts.form.editTitle'),
            pendingSubmitLabel: t(isCreate ? 'admin.proxyHosts.form.creating' : 'common.saving'),
            submitLabel: t(isCreate ? 'admin.proxyHosts.actions.create' : 'common.save'),
        },
        handler: { ...handler, handleSubmit },
    }
}
