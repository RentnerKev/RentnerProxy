import type { z } from 'zod'

import type { proxyAccessLogsQuerySchema } from '../validation.ts'

export type ProxyAccessLogsQuery = z.input<typeof proxyAccessLogsQuerySchema>
