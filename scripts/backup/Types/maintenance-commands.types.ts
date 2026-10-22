import type { runMaintenanceProcess } from '../maintenance-process.ts'

export type MaintenanceCommandOptions = Readonly<{
    cwd: string
    operation: 'backup' | 'restore'
    transformArguments?: (args: string[]) => string[]
    process?: typeof runMaintenanceProcess
}>
