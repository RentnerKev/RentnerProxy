import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { createServerEntry } from '@tanstack/react-start/server-entry'

import { withRequestAbortHandling } from '@/server/request-abort.server.ts'
import {
    startRestoreMaintenanceWatcher,
    withRestoreMaintenanceFence,
} from '@/server/Backups/restore-maintenance.server.ts'

const serverEntry = createServerEntry({
    fetch: createStartHandler(defaultStreamHandler),
})

startRestoreMaintenanceWatcher()

const fetch = withRequestAbortHandling(serverEntry.fetch)
const fencedFetch: typeof fetch = (request, options) =>
    withRestoreMaintenanceFence(request, async () => fetch(request, options))

export default {
    // Abort handling rewrites the Request, so Start must create its error context afterwards.
    fetch: fencedFetch,
}
