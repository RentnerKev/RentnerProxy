import type { LogColor, LogMethod, Logger, LoggerOptions } from './Types/logger.types'

const ANSI = {
    blue: '\u001B[34m',
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    red: '\u001B[31m',
    reset: '\u001B[0m',
} as const

function writeToStdout(output: string): void {
    process.stdout.write(output)
}

function supportsColor(): boolean {
    return process.stdout.isTTY === true && process.env.NO_COLOR === undefined
}

function formatOutput(prefix: string, styledPrefix: string, message: string): string {
    const [firstLine = '', ...continuationLines] = message.split(/\r?\n/)
    const continuationPrefix = ' '.repeat(Array.from(prefix).length)
    const lines = [
        `${styledPrefix}${firstLine}`,
        ...continuationLines.map((line) => `${continuationPrefix}${line}`),
    ]

    return `${lines.join('\n')}\n`
}

export function createLogger(options: LoggerOptions = {}): Logger {
    const colors = options.colors ?? supportsColor()
    const write = options.write ?? writeToStdout

    function method(prefix: string, color: LogColor): LogMethod {
        const styledPrefix = colors ? `${ANSI[color]}${prefix}${ANSI.reset}` : prefix

        return (message) => {
            write(formatOutput(prefix, styledPrefix, message))
        }
    }

    return {
        info: method(' INFO  ', 'blue'),
        success: method('\u258C \u2713 ', 'green'),
        done: method(' DONE  ', 'green'),
        warning: method(' WARN  ', 'yellow'),
        error: method('\u258C \u{10102} ', 'red'),
        fail: method(' FAIL  ', 'red'),
        create: method('\u258C   ', 'blue'),
    }
}

export const logger = createLogger()
