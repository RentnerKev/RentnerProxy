import { useCallback, useMemo, useState } from 'react'

import type { PageAlertProps, PageAlertsProviderLogicResult } from '../Types/page-alerts.types.ts'

export default function usePageAlertsProviderLogic(): PageAlertsProviderLogicResult {
    const [entries, setEntries] = useState<ReadonlyMap<string, PageAlertProps>>(() => new Map())
    const setAlert = useCallback((id: string, alert: PageAlertProps | null) => {
        setEntries((current) => {
            const previous = current.get(id)
            if (
                previous === alert ||
                (!previous && !alert) ||
                (previous &&
                    alert &&
                    previous.severity === alert.severity &&
                    previous.title === alert.title &&
                    previous.description === alert.description &&
                    previous.action === alert.action)
            ) {
                return current
            }
            const next = new Map(current)
            if (alert) next.set(id, alert)
            else next.delete(id)
            return next
        })
    }, [])
    const registration = useMemo(() => ({ setAlert }), [setAlert])
    const alerts = useMemo(
        () =>
            Array.from(entries, ([id, alert]) => ({ id, ...alert })).toSorted(
                (left, right) =>
                    Number(right.severity === 'error') - Number(left.severity === 'error'),
            ),
        [entries],
    )

    return { state: { alerts, registration } }
}
