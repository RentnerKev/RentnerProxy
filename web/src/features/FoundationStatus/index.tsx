import useTranslationStore from '../../language/useTranslationStore'
import ContentState from '../../shared/Management/ContentState'
import PageHeader from '../../shared/Management/PageHeader'
import { uiClassNames } from '../../shared/Styles/uiClassNames'
import FoundationStatus from './Components/FoundationStatus'
import useFoundationStatusLogic from './Hooks/useFoundationStatusLogic'

export default function FoundationStatusPage() {
    const { t } = useTranslationStore()
    const { state, handler } = useFoundationStatusLogic()

    return (
        <>
            <PageHeader
                eyebrow={t('shell.controlPlane')}
                title={t('shell.overview')}
                description={t('foundation.description')}
            />
            {state.isPending ? (
                <ContentState
                    busy
                    title={t('foundation.loading.title')}
                    description={t('foundation.loading.description')}
                />
            ) : state.isError || !state.data ? (
                <ContentState
                    title={t('foundation.error.title')}
                    description={t('foundation.error.description')}
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <FoundationStatus health={state.data} compact />
            )}
        </>
    )
}
