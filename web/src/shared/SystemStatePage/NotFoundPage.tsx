import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

import useTranslationStore from '../../language/useTranslationStore'

import SystemStatePage from './Components/SystemStatePage'

export default function NotFoundPage() {
    const { t } = useTranslationStore()
    return (
        <SystemStatePage
            code="404"
            eyebrow={t('system.notFound.eyebrow')}
            title={t('system.notFound.title')}
            description={t('system.notFound.description')}
            imageSrc="/system-not-found-v1-960.webp"
        >
            <Link
                to="/"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-navy-950 transition-colors hover:bg-brand-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
            >
                {t('common.backHome')}
                <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
        </SystemStatePage>
    )
}
