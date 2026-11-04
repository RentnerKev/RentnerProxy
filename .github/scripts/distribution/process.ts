import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'

export async function distributionBytes(
    args: readonly string[],
    options: {
        readonly cwd?: string
        readonly env?: NodeJS.ProcessEnv
        readonly timeoutMs?: number
        readonly input?: Uint8Array
    } = {},
): Promise<Uint8Array> {
    const result = await runMaintenanceProcess([...args], {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        timeoutMs: options.timeoutMs ?? 120_000,
        maximumOutputBytes: 4 * 1024 * 1024,
        ...(options.input ? { input: options.input } : {}),
    })
    if (result.failed || !result.stopped)
        throw new Error('Distribution tool invocation failed: ' + args[0], { cause: result })
    return result.stdout
}

export async function distributionCommand(
    ...args: Parameters<typeof distributionBytes>
): Promise<string> {
    return Buffer.from(await distributionBytes(...args)).toString('utf8')
}
