import { createContext } from 'react'

import type { PageAlertsRegistration, RegisteredPageAlert } from './Types/page-alerts.types.ts'

export const PageAlertsRegistrationContext = createContext<PageAlertsRegistration | null>(null)
export const PageAlertsContext = createContext<readonly RegisteredPageAlert[]>([])
