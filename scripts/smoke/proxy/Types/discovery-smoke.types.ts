import type { JsonObject, Snapshot } from './upstream-tls.types.ts'
import type { ProxyRuntimeSnapshot } from '../../../../web/src/server/ProxyRuntime/Types/proxy-runtime.types.ts'
export interface DiscoverySmokeDependencies {
    readonly directory: string
    readonly network: string
    readonly backend: string
    readonly command: (
        args: readonly string[],
        options?: { readonly inherit?: boolean; readonly timeoutMs?: number },
    ) => Promise<string>
    readonly startBackend: () => Promise<void>
    readonly controller: (path: string, init?: RequestInit) => Promise<JsonObject>
    readonly apply: (snapshot: Snapshot | ProxyRuntimeSnapshot) => Promise<JsonObject>
    readonly waitFor: (
        check: () => Promise<boolean>,
        label: string,
        timeoutMs?: number,
    ) => Promise<void>
    readonly waitForBody: (
        host: string,
        status: number,
        body: RegExp,
        label: string,
    ) => Promise<void>
}
