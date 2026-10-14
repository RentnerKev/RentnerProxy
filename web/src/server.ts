import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'
import { createServerEntry } from '@tanstack/react-start/server-entry'

import { withRequestAbortHandling } from '@/server/request-abort.server.ts'

const serverEntry = createServerEntry({
    fetch: createStartHandler(defaultStreamHandler),
})

export default {
    // Abort handling rewrites the Request, so Start must create its error context afterwards.
    fetch: withRequestAbortHandling(serverEntry.fetch),
}
