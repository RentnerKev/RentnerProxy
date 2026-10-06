import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

import { exportRuntimeSupportReportService } from '@/server/RuntimeDiagnostics/support-report.service.ts'
import { throwLocalizedQueryError } from '@/server/Auth/transport.server.ts'

export const exportRuntimeSupportReportHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        setResponseHeader('Cache-Control', 'private, no-store')
        setResponseHeader('X-Content-Type-Options', 'nosniff')
        try {
            return await exportRuntimeSupportReportService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.runtimeDiagnostics.downloadFailed')
        }
    },
)
