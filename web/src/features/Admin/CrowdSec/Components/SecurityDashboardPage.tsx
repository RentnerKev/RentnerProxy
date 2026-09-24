import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useSecurityDashboardPageLogic from '../Hooks/useSecurityDashboardPageLogic'
import CrowdSecDashboardPanel from './CrowdSecDashboardPanel'

export default function SecurityDashboardPage() {
    const { t } = useTranslationStore()
    const configuration = useSecurityDashboardPageLogic()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.crowdSec.dashboard.eyebrow')}
                title={t('admin.crowdSec.dashboard.title')}
                description={t('admin.crowdSec.dashboard.description')}
                action={
                    <Link to="/crowdsec" className={uiClassNames.button.secondary}>
                        <Settings2 aria-hidden="true" className="size-4" />
                        {t('admin.crowdSec.dashboard.configuration')}
                    </Link>
                }
            />
            {!configuration.data ? (
                <ContentState
                    title={t(
                        configuration.isError
                            ? 'admin.crowdSec.statesPage.unavailableTitle'
                            : 'admin.crowdSec.statesPage.loadingTitle',
                    )}
                    description={t(
                        configuration.isError
                            ? 'admin.crowdSec.statesPage.unavailableDescription'
                            : 'admin.crowdSec.statesPage.loadingDescription',
                    )}
                    action={
                        configuration.isError ? (
                            <button
                                type="button"
                                className={uiClassNames.button.secondary}
                                onClick={() => void configuration.refetch()}
                            >
                                {t('common.retry')}
                            </button>
                        ) : undefined
                    }
                />
            ) : (
                <CrowdSecDashboardPanel configuration={configuration.data} />
            )}
        </>
    )
}
