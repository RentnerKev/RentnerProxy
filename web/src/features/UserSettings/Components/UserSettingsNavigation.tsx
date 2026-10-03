import { Link } from '@tanstack/react-router'
import { Fingerprint, Globe, LockKeyhole, Palette, ShieldCheck, UserRound } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import UserAvatar from '@/shared/Avatar/Components/UserAvatar.tsx'
import type { UserSettingsPageProps } from '../Types/user-settings-component-props.types.ts'

const groups = [
    {
        label: 'account.navigation.groups.profile',
        items: [
            { section: 'profile', label: 'account.navigation.profile', icon: UserRound },
            { section: 'language', label: 'account.navigation.language', icon: Globe },
            { section: 'appearance', label: 'account.navigation.appearance', icon: Palette },
        ],
    },
    {
        label: 'account.navigation.groups.signIn',
        items: [
            { section: 'password', label: 'account.navigation.password', icon: LockKeyhole },
            { section: 'two-factor', label: 'account.navigation.twoFactor', icon: ShieldCheck },
            { section: 'passkeys', label: 'account.navigation.passkeys', icon: Fingerprint },
        ],
    },
] as const

export default function UserSettingsNavigation({ user, activeSection }: UserSettingsPageProps) {
    const { t } = useTranslationStore()

    return (
        <aside className="min-w-0 self-start rounded-2xl border border-border bg-surface p-3 shadow-surface lg:p-4">
            <div className="mb-3 flex min-w-0 items-center gap-3 border-b border-border px-2 pb-4 lg:mb-5 lg:pb-5">
                <UserAvatar userId={user.id} profileImageVersion={user.profileImageVersion} />
                <div className="min-w-0">
                    <p className="m-0 truncate font-extrabold text-ink-soft">{user.displayName}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                            <span
                                key={role}
                                className="rounded-full border border-success-text/20 bg-success-bg px-2 py-0.5 font-mono text-[0.65rem] font-bold text-success-text"
                            >
                                {role}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <nav
                aria-label={t('account.navigation.label')}
                className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1 lg:gap-0"
            >
                {groups.map((group) => (
                    <div
                        key={group.label}
                        className="contents lg:block lg:border-t lg:border-border lg:py-4 lg:first:border-t-0 lg:first:pt-0 lg:last:pb-0"
                    >
                        <p className="mb-2 hidden px-3 font-mono text-[0.65rem] font-bold tracking-[0.14em] text-muted uppercase lg:block">
                            {t(group.label)}
                        </p>
                        <div className="contents lg:grid lg:gap-1">
                            {group.items.map(({ section, label, icon: Icon }) => {
                                const active = activeSection === section

                                return (
                                    <Link
                                        key={section}
                                        to="/account"
                                        search={{ section }}
                                        resetScroll={false}
                                        aria-current={active ? 'page' : undefined}
                                        className={`relative flex min-w-0 items-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring motion-reduce:transition-none lg:gap-3 ${
                                            active
                                                ? 'bg-accent-muted text-ink before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent'
                                                : 'text-muted hover:bg-surface-hover hover:text-ink'
                                        }`}
                                    >
                                        <Icon
                                            aria-hidden="true"
                                            className={`size-4 shrink-0 lg:size-5 ${active ? 'text-brand-text' : ''}`}
                                        />
                                        <span className="min-w-0 break-words">{t(label)}</span>
                                    </Link>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </nav>
        </aside>
    )
}
