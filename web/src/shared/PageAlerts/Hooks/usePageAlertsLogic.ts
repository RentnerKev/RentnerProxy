import { useContext, useState } from 'react'

import { PageAlertsContext } from '../pageAlertsContext.ts'
import type { PageAlertsLogicResult } from '../Types/page-alerts.types.ts'

export default function usePageAlertsLogic(): PageAlertsLogicResult {
    const alerts = useContext(PageAlertsContext)
    const [openAlertId, setOpenAlertId] = useState<string | null>(null)

    return {
        state: {
            alerts,
            severity: alerts.some((alert) => alert.severity === 'error') ? 'error' : 'warning',
            open: alerts.some((alert) => alert.id === openAlertId),
        },
        handler: {
            handleOpenChange: (open) => setOpenAlertId(open ? (alerts[0]?.id ?? null) : null),
        },
    }
}
