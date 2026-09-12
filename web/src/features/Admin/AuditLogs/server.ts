import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import { listAuditEventsService } from '../../../server/Audit/audit-reader.service'
import { throwLocalizedQueryError } from '../../Auth/serverHelpers'
import { auditEventsQuerySchema } from './validation'

export const getAuditEventsHandler = createServerFn({ method: 'GET' })
    .validator(auditEventsQuerySchema)
    .handler(async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store')
        try {
            return await listAuditEventsService(data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.auditLogs.errors.loadFailed')
        }
    })
