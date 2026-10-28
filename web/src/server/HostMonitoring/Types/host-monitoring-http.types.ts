import type { hostMonitoringService } from '../host-monitoring.service.ts'

export interface HostMonitoringHttpDependencies {
    readonly service: typeof hostMonitoringService
    readonly origin: () => string | null
}
