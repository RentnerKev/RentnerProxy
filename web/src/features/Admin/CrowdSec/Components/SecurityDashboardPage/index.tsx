import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
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
            {!state.configuration ? (
                <ContentState
                    title={t(
                        state.isError
                            ? 'admin.crowdSec.statesPage.unavailableTitle'
                            : 'admin.crowdSec.statesPage.loadingTitle',
                    )}
                    description={t(
                        state.isError
                            ? 'admin.crowdSec.statesPage.unavailableDescription'
                            : 'admin.crowdSec.statesPage.loadingDescription',
                    )}
                    action={
                        state.isError ? (
                            <button
                                type="button"
                                className={buttonClassName('secondary')}
                                onClick={handler.handleRetry}
                            >
                                {t('common.retry')}
                            </button>
                        ) : undefined
                    }
                />
            ) : (
                <CrowdSecDashboardPanel configuration={state.configuration} />
            )}
        </>
    )
}
