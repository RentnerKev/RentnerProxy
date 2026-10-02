import { Link } from '@tanstack/react-router'
import { Settings2 } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import useSecurityDashboardPageLogic from './Hooks/useSecurityDashboardPageLogic.ts'
import CrowdSecDashboardPanel from '../CrowdSecDashboardPanel/index.tsx'
import ForwardAuthSummaryPanel from '../ForwardAuthSummaryPanel/index.tsx'

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
                    <Link
                        to="/crowdsec"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                    >
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
                                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
