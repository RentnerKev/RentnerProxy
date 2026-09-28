import { PERMISSIONS } from '../../config/permissions.config'
import useTranslationStore from '../../language/useTranslationStore'
import ContentState from '../../shared/Management/ContentState'
import PageHeader from '../../shared/Management/PageHeader'
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
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
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
