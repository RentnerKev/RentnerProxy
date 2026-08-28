import ContentState from '../../shared/Management/ContentState'
import PageHeader from '../../shared/Management/PageHeader'
import { uiClassNames } from '../../shared/Styles/uiClassNames'
import FoundationStatus from './Components/FoundationStatus'
import useFoundationStatusLogic from './Hooks/useFoundationStatusLogic'

export default function FoundationStatusPage() {
    const healthQuery = useFoundationStatusLogic()

    return (
        <>
            <PageHeader
                eyebrow="Control plane"
                title="Overview"
                description="A compact connection check for every service that supports this RentnerProxy instance."
            />
            {healthQuery.isPending ? (
                <ContentState
                    busy
                    title="Checking connections"
                    description="RentnerProxy is verifying the controller, PostgreSQL, and Redis."
                />
            ) : healthQuery.isError || !healthQuery.data ? (
                <ContentState
                    title="Health check unavailable"
                    description="The application is running, but the service status could not be refreshed."
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={() => healthQuery.refetch()}
                        >
                            Try again
                        </button>
                    }
                />
            ) : (
                <FoundationStatus health={healthQuery.data} compact />
            )}
        </>
    )
}
