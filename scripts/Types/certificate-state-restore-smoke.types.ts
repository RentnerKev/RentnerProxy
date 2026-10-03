export type Command = (args: string[], options?: { timeoutMs?: number }) => Promise<string>
