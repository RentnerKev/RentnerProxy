import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

import { withRequestAbortHandling } from '@/server/request-abort.server.ts'

export default {
    fetch: withRequestAbortHandling(createStartHandler(defaultStreamHandler)),
}
