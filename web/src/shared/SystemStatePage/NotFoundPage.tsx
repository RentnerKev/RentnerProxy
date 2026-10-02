import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import SystemStatePage from './Components/SystemStatePage.tsx'

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
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-0 text-sm font-bold text-accent-foreground transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
            >
                {t('common.backHome')}
                <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
        </SystemStatePage>
    )
}
