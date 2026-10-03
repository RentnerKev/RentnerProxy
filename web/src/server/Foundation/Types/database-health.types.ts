export interface DatabaseProbe {
    readonly result: Promise<unknown>
    cancel(): void
}

export interface DatabaseHealthDependencies {
    readonly createProbe: () => DatabaseProbe | null
    readonly timeoutMs: number
    readonly warn: (reason: string) => void
}
