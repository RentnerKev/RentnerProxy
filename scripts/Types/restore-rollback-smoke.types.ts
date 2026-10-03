export type Command = (argumentsList: string[], timeoutMs?: number) => Promise<string>

type CommandWithEnvironment = (
    argumentsList: string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs?: number,
) => Promise<string>

export type BackupMetadata = {
    postgres?: {
        bytes?: number
        database?: string
        dump?: string
        sha256?: string
        user?: string
    }
    [key: string]: unknown
}

export type VerifyRestoreRollbackInput = Readonly<{
    containerId: string
    command: Command
    commandWithEnvironment: CommandWithEnvironment
    environment: NodeJS.ProcessEnv
    waitForHealthy: () => Promise<void>
    composeFile: string
    project: string
    backupPath: string
    temporaryRoot: string
}>
