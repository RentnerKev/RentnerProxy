import { Link } from '@tanstack/react-router'

import { uiClassNames } from '../../Styles/uiClassNames'
import type { ApplicationNavigationProps } from '../Types/application-shell.types'

const navigationLinkClassName =
    'inline-flex flex-none items-center gap-[0.65rem] rounded-[0.65rem] border border-transparent px-3 py-[0.65rem] text-[0.85rem] font-[750] text-mist-300 no-underline transition-[background-color,border-color,color] duration-150 hover:border-brand-500/20 hover:bg-brand-500/10 hover:text-white motion-reduce:transition-none [&>span]:size-[0.42rem] [&>span]:rounded-full [&>span]:bg-mist-500'
const activeNavigationLinkClassName = `${navigationLinkClassName} border-brand-500/20 bg-brand-500/10 text-white [&>span]:bg-brand-500 [&>span]:shadow-[0_0_0_4px_rgb(48_238_97_/_12%)]`

export default function ApplicationNavigation({ items }: ApplicationNavigationProps) {
    return (
        <nav
            aria-label="Application navigation"
            className="flex gap-[0.4rem] overflow-x-auto pb-1 shell:grid shell:overflow-visible"
        >
            <p className={`${uiClassNames.technicalLabel} mb-[0.6rem] ml-3 hidden shell:block`}>
                Control plane
            </p>
            {items.map((item) => (
                <Link
                    key={item.to}
                    to={item.to}
                    activeOptions={{ exact: item.exact ?? false }}
                    className={navigationLinkClassName}
                    activeProps={{ className: activeNavigationLinkClassName }}
                >
                    <span aria-hidden="true" />
                    {item.label}
                </Link>
            ))}
        </nav>
    )
}
