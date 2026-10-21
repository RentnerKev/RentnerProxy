import type { ReactElement } from 'react'
import { act } from 'react'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'

import { TOOLTIP_PROVIDER_PROPS } from '@/config/tooltip.config.ts'
import PageAlerts from '@/shared/PageAlerts/index.tsx'
import PageAlertsProvider from '@/shared/PageAlerts/PageAlertsProvider.tsx'

export default function withTestPageAlerts(element: ReactElement) {
    return (
        <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
            <PageAlertsProvider>
                <PageAlerts />
                {element}
            </PageAlertsProvider>
        </TooltipProvider>
    )
}

export async function openPageAlerts(): Promise<HTMLElement> {
    const trigger = document.querySelector<HTMLButtonElement>('button[data-severity]')
    if (!trigger) throw new Error('No page alert indicator is available.')
    if (trigger.getAttribute('aria-expanded') !== 'true') {
        await act(async () => trigger.click())
    }
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Page alerts"]')
    if (!dialog) throw new Error('Page alert details did not open.')
    return dialog
}
