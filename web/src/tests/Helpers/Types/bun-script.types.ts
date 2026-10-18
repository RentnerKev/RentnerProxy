export interface BunScriptOptions {
    readonly cwd: string | URL
    readonly env?: Record<string, string | undefined>
}
