import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import useSecurityDashboardPageLogic from './Hooks/useSecurityDashboardPageLogic.ts'
import CrowdSecDashboardPanel from '../CrowdSecDashboardPanel/index.tsx'
import ForwardAuthSummaryPanel from '../ForwardAuthSummaryPanel/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import type { CrowdSecPageProps } from '../../Types/crowdsec.types.ts'

export default function SecurityDashboardPage({ permissions }: CrowdSecPageProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useSecurityDashboardPageLogic(permissions)
    return (
        <>
            <PageHeader
                eyebrow={t('admin.crowdSec.dashboard.eyebrow')}
                title={t('admin.crowdSec.dashboard.title')}
                description={t('admin.crowdSec.dashboard.description')}
            />
            <ForwardAuthSummaryPanel enabled={state.canViewAccessPolicies} />
            {state.isError ? (
                <PageAlert
                    severity="error"
                    title={t('admin.crowdSec.statesPage.unavailableTitle')}
                    description={t('admin.crowdSec.statesPage.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.handleRetry}
                            disabled={state.isRetrying}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : null}
            {state.configuration ? (
                <CrowdSecDashboardPanel configuration={state.configuration} />
            ) : !state.isError ? (
                <ContentState
                    busy
                    title={t('admin.crowdSec.statesPage.loadingTitle')}
                    description={t('admin.crowdSec.statesPage.loadingDescription')}
                />
            ) : null}
        </>
    )
}
