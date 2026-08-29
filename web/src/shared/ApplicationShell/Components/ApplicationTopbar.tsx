import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { Tooltip } from '../../Tooltip'
import {
    applicationShellClassNames,
    getApplicationTopbarClassName,
} from '../Styles/applicationShellClassNames'
import type { ApplicationTopbarProps } from '../Types/application-shell.types'

export default function ApplicationTopbar({
    isNavigationExpanded,
    navigationToggleLabel,
    onToggleNavigation,
    themeControl,
}: ApplicationTopbarProps) {
    return (
        <header className={getApplicationTopbarClassName(isNavigationExpanded)}>
            <Tooltip content={navigationToggleLabel} side="right">
                <button
                    type="button"
                    className={applicationShellClassNames.topbar.toggle}
                    aria-controls="application-navigation"
                    aria-expanded={isNavigationExpanded}
                    aria-label={navigationToggleLabel}
                    onClick={onToggleNavigation}
                >
                    <PanelLeftOpen
                        aria-hidden="true"
                        className="size-4 group-aria-expanded:hidden"
                        strokeWidth={1.7}
                    />
                    <PanelLeftClose
                        aria-hidden="true"
                        className="hidden size-4 group-aria-expanded:block"
                        strokeWidth={1.7}
                    />
                </button>
            </Tooltip>
            <div className={applicationShellClassNames.topbar.theme}>{themeControl}</div>
        </header>
    )
}
