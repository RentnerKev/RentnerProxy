import { Link } from '@tanstack/react-router'
import {
    ArrowRight,
    Award,
    ClipboardList,
    KeyRound,
    LayoutDashboard,
    Network,
    Import,
    ScrollText,
    Shield,
    ShieldAlert,
    ShieldCheck,
    UsersRound,
} from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'

import type { ApplicationNavigationProps } from '../Types/application-shell.types'

export default function ApplicationNavigation({ items, onNavigate }: ApplicationNavigationProps) {
    const { t } = useTranslationStore()
    return (
        <nav aria-label={t('shell.navigation')} className="grid content-start gap-[0.4rem]">
            {items.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: item.exact ?? false }}
                    onClick={onNavigate}
                    className="group relative inline-flex w-full flex-none cursor-pointer items-center gap-[0.65rem] border-y border-transparent px-3.5 py-[0.72rem] text-[0.85rem] font-[750] text-mist-300 no-underline transition-[background-color,border-color,color] duration-180 hover:border-white/10 hover:bg-white/[0.055] hover:text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300 shell:-ml-[1.35rem] shell:w-[calc(100%+4.125rem)] shell:pl-[2.2rem] motion-reduce:transition-none"
                    activeProps={{
                        className: 'border-brand-500/20 bg-brand-500/12 text-white',
                    }}
                >
                    {item.to === '/' ? (
                        <LayoutDashboard
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/proxy-hosts' ? (
                        <Network aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    ) : item.to === '/redirect-hosts' ? (
                        <ArrowRight
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/certificates' ? (
                        <Award aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    ) : item.to === '/users' ? (
                        <UsersRound
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/access-policies' ? (
                        <KeyRound
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/proxy-access-logs' ? (
                        <ScrollText
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/audit-logs' ? (
                        <ClipboardList
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/security' ? (
                        <ShieldAlert
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/crowdsec' ? (
                        <Shield aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    ) : item.to === '/roles' ? (
                        <ShieldCheck
                            aria-hidden="true"
                            className="size-4 shrink-0"
                            strokeWidth={1.8}
                        />
                    ) : item.to === '/npm-import' || item.to === '/migration' ? (
                        <Import aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    ) : null}
                    {item.label}
                </Link>
            ))}
        </nav>
    )
}
