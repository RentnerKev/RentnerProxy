import { createFileRoute } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'

import { getLiveSnapshotResponse } from '../../websockets/Server/realtimeSnapshots.service'

const readSnapshot = createServerOnlyFn(getLiveSnapshotResponse)

export const Route = createFileRoute('/api/live-snapshot')({
    server: {
        handlers: { GET: ({ request }) => readSnapshot(request) },
    },
})
