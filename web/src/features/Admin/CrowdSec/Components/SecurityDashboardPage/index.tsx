import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import useSecurityDashboardPageLogic from './Hooks/useSecurityDashboardPageLogic.ts'
import CrowdSecDashboardPanel from '../CrowdSecDashboardPanel/index.tsx'
import ForwardAuthSummaryPanel from '../ForwardAuthSummaryPanel/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function SecurityDashboardPage() {
    const { t } = useTranslationStore()
    const { state, handler } = useSecurityDashboardPageLogic()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.crowdSec.dashboard.eyebrow')}
                title={t('admin.crowdSec.dashboard.title')}
                description={t('admin.crowdSec.dashboard.description')}
                action={
                    <Link to="/crowdsec" className={buttonClassName('secondary')}>
                        <Settings2 aria-hidden="true" className="size-4" />
                        {t('admin.crowdSec.dashboard.configuration')}
                    </Link>
                }
            />
            <ForwardAuthSummaryPanel />
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
