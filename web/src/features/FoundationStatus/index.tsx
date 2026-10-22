import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import FoundationStatus from './Components/FoundationStatus/index.tsx'
import CrowdSecOverview from './Components/CrowdSecOverview/index.tsx'
import useFoundationStatusLogic from './Hooks/useFoundationStatusLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function FoundationStatusPage({
    permissions,
}: {
    readonly permissions: readonly string[]
}) {
    const { t } = useTranslationStore()
    const { state, handler } = useFoundationStatusLogic(permissions)

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
                <PageAlert
                    severity="error"
                    title={t('foundation.error.title')}
                    description={t('foundation.error.description')}
                    action={
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <FoundationStatus health={state.data} liveStatus={state.liveStatus} compact />
            )}
            <CrowdSecOverview enabled={state.canViewCrowdSec} />
        </>
    )
}
