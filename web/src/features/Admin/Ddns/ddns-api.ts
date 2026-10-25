import {
    getDdnsStatusHandler,
    getDdnsProvidersHandler,
    getDdnsConnectionsHandler,
    previewDdnsHandler,
    saveDdnsHandler,
    enableDdnsHandler,
    disableDdnsHandler,
    syncDdnsHandler,
    applyDdnsHandler,
} from './middleware.ts'
import type { DdnsApi } from './Types/ddns-ui.types.ts'
export const ddnsApi: DdnsApi = {
    apply: (data) => applyDdnsHandler({ data }),
    providers: () => getDdnsProvidersHandler(),
    status: () => getDdnsStatusHandler(),
    connections: () => getDdnsConnectionsHandler(),
    preview: (data) => previewDdnsHandler({ data }),
    save: (data) => saveDdnsHandler({ data }),
    enable: (data) => enableDdnsHandler({ data }),
    disable: (data) => disableDdnsHandler({ data }),
    sync: (data) => syncDdnsHandler({ data }),
}
