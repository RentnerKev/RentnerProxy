import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ApplicationMobileNavigationProps } from '../Types/application-shell.types.ts'

export default function ApplicationMobileNavigation({
    open,
    onOpenChange,
    onCloseAutoFocus,
    children,
}: ApplicationMobileNavigationProps) {
    const { t } = useTranslationStore()

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/70" />
                <Dialog.Content
                    id="application-mobile-navigation"
                    aria-modal="true"
                    aria-describedby={undefined}
                    onCloseAutoFocus={onCloseAutoFocus}
                    className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-navy-950 text-white shadow-2xl outline-hidden"
                >
                    <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-[0.8rem]">
                        <Dialog.Title className="m-0 text-sm font-bold">
                            {t('shell.navigation')}
                        </Dialog.Title>
                        <Dialog.Close
                            type="button"
                            aria-label={t('shell.collapseNavigation')}
                            className="grid size-11 cursor-pointer place-items-center rounded-full border border-brand-500/40 bg-brand-500/10 text-brand-400 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-300"
                        >
                            <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
                        </Dialog.Close>
                    </header>
                    {children}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
