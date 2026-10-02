import { getDefaultSitePageViewModel } from '@/lib/DefaultSite/defaultSitePage.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import DefaultSitePanel from './Components/DefaultSitePanel/index.tsx'
import type { DefaultSitePageProps } from './Types/default-site-page.types.ts'

export default function OperationsPage({ permissions }: DefaultSitePageProps) {
    const { t } = useTranslationStore()
    const viewModel = getDefaultSitePageViewModel(permissions)

    return viewModel.canView ? (
        <>
            <PageHeader
                eyebrow={t('operations.page.eyebrow')}
                title={t('operations.page.title')}
                description={t('operations.page.description')}
            />
            <DefaultSitePanel canUpdate={viewModel.canUpdate} />
        </>
    ) : null
}
