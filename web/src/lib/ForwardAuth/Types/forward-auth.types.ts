import type { z } from 'zod'

import type {
    FORWARD_AUTH_PROVIDERS,
    FORWARD_AUTH_REQUEST_HEADERS,
    forwardAuthInputSchema,
    forwardAuthRuntimeSchema,
} from '../forwardAuth.ts'

export type ForwardAuthProvider = (typeof FORWARD_AUTH_PROVIDERS)[number]

export type ForwardAuthRequestHeader = (typeof FORWARD_AUTH_REQUEST_HEADERS)[number]

export type ForwardAuthConfiguration = z.output<typeof forwardAuthInputSchema>

export type ForwardAuthRuntimeConfiguration = z.output<typeof forwardAuthRuntimeSchema>
