import { createFileRoute } from '@tanstack/react-router'

import FoundationStatusPage from '../../features/FoundationStatus'

export const Route = createFileRoute('/_authenticated/')({
    component: FoundationStatusPage,
})
