import type { DomainDiagnosticsResult } from '../../../../web/src/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import type { ProxyHost, Snapshot } from './upstream-tls.types.ts'

export interface DomainDiagnosticsSmokeOptions {
    readonly controller: (path: string, init?: RequestInit) => Promise<Response>
    readonly snapshot: Pick<Snapshot, 'revision'>
    readonly host: Pick<ProxyHost, 'id' | 'domains'>
    readonly upstreamCode: DomainDiagnosticsResult['stages']['upstream']['code']
    readonly tlsCode: DomainDiagnosticsResult['stages']['tls']['code']
    readonly checkBoundary?: boolean
}
