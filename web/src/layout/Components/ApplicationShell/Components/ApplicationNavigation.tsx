import { Link } from '@tanstack/react-router'
import { Network } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'

import { applicationShellClassNames } from '../Styles/applicationShellClassNames'
import type { ApplicationNavigationProps } from '../Types/application-shell.types'

export default function ApplicationNavigation({ items }: ApplicationNavigationProps) {
    const { t } = useTranslationStore()
    return (
        <nav
            aria-label={t('shell.navigation')}
            className={applicationShellClassNames.navigation.root}
        >
            <p className={applicationShellClassNames.navigation.label}>{t('shell.controlPlane')}</p>
            {items.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: item.exact ?? false }}
                    className={applicationShellClassNames.navigation.link}
                    activeProps={{
                        className: applicationShellClassNames.navigation.activeLink,
                    }}
                >
                    {item.to === '/proxy-hosts' ? (
                        <Network aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    ) : (
                        <span aria-hidden="true" />
                    )}
                    {item.label}
                </Link>
            ))}
        </nav>
    )
}
