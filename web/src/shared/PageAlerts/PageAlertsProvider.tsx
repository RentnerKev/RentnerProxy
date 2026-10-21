import usePageAlertsProviderLogic from './Hooks/usePageAlertsProviderLogic.ts'
import { PageAlertsContext, PageAlertsRegistrationContext } from './pageAlertsContext.ts'
import type { PageAlertsProviderProps } from './Types/page-alerts.types.ts'

export default function PageAlertsProvider({ children }: PageAlertsProviderProps) {
    const { state } = usePageAlertsProviderLogic()

    return (
        <PageAlertsRegistrationContext value={state.registration}>
            <PageAlertsContext value={state.alerts}>{children}</PageAlertsContext>
        </PageAlertsRegistrationContext>
    )
}
