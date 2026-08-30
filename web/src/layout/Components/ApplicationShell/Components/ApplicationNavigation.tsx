import { Link } from '@tanstack/react-router'

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
                    <span aria-hidden="true" />
                    {item.label}
                </Link>
            ))}
        </nav>
    )
}
