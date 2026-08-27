export type LogColor = 'blue' | 'green' | 'red' | 'yellow'
export type LogMethod = (message: string) => void
export type LogWriter = (output: string) => void

export interface Logger {
    readonly create: LogMethod
    readonly done: LogMethod
    readonly error: LogMethod
    readonly fail: LogMethod
    readonly info: LogMethod
    readonly success: LogMethod
    readonly warning: LogMethod
}

export interface LoggerOptions {
    readonly colors?: boolean
    readonly write?: LogWriter
}
