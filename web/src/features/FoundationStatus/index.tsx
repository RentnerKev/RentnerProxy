import { PERMISSIONS } from '../../config/permissions.config'
import useTranslationStore from '../../language/useTranslationStore'
import ContentState from '../../shared/Management/ContentState'
import PageHeader from '../../shared/Management/PageHeader'
import { uiClassNames } from '../../shared/Styles/uiClassNames'
import FoundationStatus from './Components/FoundationStatus'
import CrowdSecOverview from './Components/CrowdSecOverview'
import useCrowdSecOverviewLogic from './Hooks/useCrowdSecOverviewLogic'
import useFoundationStatusLogic from './Hooks/useFoundationStatusLogic'

export default function FoundationStatusPage({
    permissions,
}: {
    readonly permissions: readonly string[]
}) {
    const { t } = useTranslationStore()
    const { state, handler } = useFoundationStatusLogic()
    const canViewCrowdSec = permissions.includes(PERMISSIONS.CROWDSEC_VIEW)
    const crowdSec = useCrowdSecOverviewLogic(canViewCrowdSec)

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
                <FoundationStatus health={state.data} liveStatus={state.liveStatus} compact />
            )}
            {canViewCrowdSec ? <CrowdSecOverview logic={crowdSec} /> : null}
        </>
    )
}
