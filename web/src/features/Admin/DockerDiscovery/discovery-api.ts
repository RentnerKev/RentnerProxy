import {
    getDiscoveryOverviewHandler,
    inspectDiscoveryHandler,
    connectDiscoveryHandler,
    changeDiscoveryHandler,
} from './middleware.ts'
import type { DiscoveryApi } from './Types/discovery-ui.types.ts'
function unwrap<T>(response: { success: true; value: T } | { success: false; message: string }): T {
    if (!response.success) throw new Error(response.message)
    return response.value
}
export const discoveryApi: DiscoveryApi = {
    status: () => getDiscoveryOverviewHandler(),
    inspect: async (data) => unwrap(await inspectDiscoveryHandler({ data })),
    connect: async (data) => unwrap(await connectDiscoveryHandler({ data })),
    change: async (data) => unwrap(await changeDiscoveryHandler({ data })),
}
