import { useContext, useEffect, useId } from 'react'

import { PageAlertsRegistrationContext } from '../pageAlertsContext.ts'
import type { PageAlertProps } from '../Types/page-alerts.types.ts'

export default function usePageAlert({ severity, title, description, action }: PageAlertProps) {
    const id = useId()
    const registration = useContext(PageAlertsRegistrationContext)

    useEffect(() => {
        registration?.setAlert(id, { severity, title, description, action })
    }, [registration, id, severity, title, description, action])

    useEffect(() => () => registration?.setAlert(id, null), [registration, id])
}
