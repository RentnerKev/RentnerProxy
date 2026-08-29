import { Link } from '@tanstack/react-router'

import { applicationShellClassNames } from '../Styles/applicationShellClassNames'
import type { ApplicationNavigationProps } from '../Types/application-shell.types'

export default function ApplicationNavigation({ items }: ApplicationNavigationProps) {
    return (
        <nav
            aria-label="Application navigation"
            className={applicationShellClassNames.navigation.root}
        >
            <p className={applicationShellClassNames.navigation.label}>Control plane</p>
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
