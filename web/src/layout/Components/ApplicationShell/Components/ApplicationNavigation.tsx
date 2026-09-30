import { Link } from '@tanstack/react-router'
import {
    ArrowRight,
    Award,
    ChevronDown,
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

import useApplicationNavigationGroupsLogic from '../Hooks/useApplicationNavigationGroupsLogic'
import type { ApplicationNavigationProps } from '../Types/application-shell.types'

export default function ApplicationNavigation({
    items,
    onNavigate,
    groupPreferences,
    onGroupChange,
}: ApplicationNavigationProps) {
    const { t } = useTranslationStore()
    const { groups, activeGroupId, expandedGroupIds, instanceId, toggleGroup } =
        useApplicationNavigationGroupsLogic(items, groupPreferences, onGroupChange)

    return (
        <nav aria-label={t('shell.navigation')} className="grid content-start gap-2.5">
            {groups.map((group) => {
                const isExpanded = expandedGroupIds.has(group.id)
                const isActive = activeGroupId === group.id
                const panelId = `${instanceId}-${group.id}`

                return (
                    <section key={group.id} className="min-w-0">
                        <button
                            type="button"
                            aria-controls={panelId}
                            aria-expanded={isExpanded}
                            onClick={() => toggleGroup(group.id)}
                            className={`group relative flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 border-y border-transparent px-3.5 py-2 text-left font-mono text-[0.67rem] font-bold tracking-[0.09em] uppercase transition-[background-color,border-color,color] duration-180 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-300 shell:-ml-[1.35rem] shell:w-[calc(100%+4.125rem)] shell:pr-14 shell:pl-[2.2rem] motion-reduce:transition-none ${
                                isActive
                                    ? 'border-brand-500/20 bg-brand-500/12 text-brand-300'
                                    : 'bg-white/[0.025] text-mist-300 hover:border-white/10 hover:bg-white/[0.055] hover:text-white'
                            }`}
                        >
                            <span
                                aria-hidden="true"
                                className={`absolute top-1/2 left-1 h-5 w-0.5 -translate-y-1/2 rounded-full transition-colors duration-180 motion-reduce:transition-none ${isActive ? 'bg-brand-400' : 'bg-white/20 group-hover:bg-brand-500/60'}`}
                            />
                            <span className="flex min-w-0 items-center gap-2.5">
                                <span
                                    aria-hidden="true"
                                    className={`size-1.5 shrink-0 rounded-full ${isActive ? 'bg-brand-400 shadow-[0_0_8px_var(--color-accent)]' : 'bg-mist-400/70'}`}
                                />
                                <span className="truncate">
                                    {t(`shell.navigationGroups.${group.id}`)}
                                </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-mist-400">
                                <span className="tabular-nums">{group.items.length}</span>
                                <ChevronDown
                                    aria-hidden="true"
                                    className={`size-3.5 transition-transform duration-200 motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
                                    strokeWidth={2}
                                />
                            </span>
                        </button>
                        <div
                            id={panelId}
                            hidden={!isExpanded}
                            className={isExpanded ? 'grid gap-[0.2rem] pt-1' : 'hidden'}
                        >
                            {group.items.map((item) => (
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
                                        <Network
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                            strokeWidth={1.8}
                                        />
                                    ) : item.to === '/redirect-hosts' ? (
                                        <ArrowRight
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                            strokeWidth={1.8}
                                        />
                                    ) : item.to === '/certificates' ? (
                                        <Award
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                            strokeWidth={1.8}
                                        />
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
                                        <Shield
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                            strokeWidth={1.8}
                                        />
                                    ) : item.to === '/roles' ? (
                                        <ShieldCheck
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                            strokeWidth={1.8}
                                        />
                                    ) : item.to === '/npm-import' || item.to === '/migration' ? (
                                        <Import
                                            aria-hidden="true"
                                            className="size-4 shrink-0"
                                            strokeWidth={1.8}
                                        />
                                    ) : null}
                                    {item.label}
                                </Link>
                            ))}
                        </div>
                    </section>
                )
            })}
        </nav>
    )
}
