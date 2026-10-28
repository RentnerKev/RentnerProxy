export class HostMonitoringError extends Error {
    constructor(readonly code: 'invalid_input' | 'host_not_found' | 'conflict' | 'limit_reached') {
        super(code)
    }
}
