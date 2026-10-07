export type ApplianceCommand = (args: string[], timeoutMs?: number) => Promise<string>
