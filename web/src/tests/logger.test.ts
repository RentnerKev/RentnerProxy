import { describe, expect, test } from 'bun:test'

import { createLogger } from '../../../scripts/logger'
import type { LoggerMethod } from './Types/logger-test.types'

const ANSI = {
    blue: '\u001B[34m',
    green: '\u001B[32m',
    yellow: '\u001B[33m',
    red: '\u001B[31m',
    reset: '\u001B[0m',
} as const

const methodCases = [
    ['info', ' INFO  ', ANSI.blue],
    ['success', '\u258C \u2713 ', ANSI.green],
    ['done', ' DONE  ', ANSI.green],
    ['warning', ' WARN  ', ANSI.yellow],
    ['error', '\u258C \u{10102} ', ANSI.red],
    ['fail', ' FAIL  ', ANSI.red],
    ['create', '\u258C   ', ANSI.blue],
] as const satisfies ReadonlyArray<readonly [LoggerMethod, string, string]>

describe('createLogger', () => {
    for (const [method, prefix, color] of methodCases) {
        test(`writes ${method} with its ANSI prefix`, () => {
            const output: string[] = []
            const logger = createLogger({ colors: true, write: (value) => output.push(value) })

            logger[method]('RentnerProxy')

            expect(output).toEqual([`${color}${prefix}${ANSI.reset}RentnerProxy\n`])
        })
    }

    test('writes plain output without ANSI escape codes when colors are disabled', () => {
        const output: string[] = []
        const logger = createLogger({ colors: false, write: (value) => output.push(value) })

        logger.info('Starting controller')

        expect(output).toEqual([' INFO  Starting controller\n'])
        expect(output[0]).not.toContain('\u001B[')
    })

    test('preserves long messages and aligns explicit continuation lines', () => {
        const output: string[] = []
        const logger = createLogger({ colors: false, write: (value) => output.push(value) })
        const longMessage = 'x'.repeat(240)

        logger.info(`${longMessage}\nController details`)

        expect(output).toEqual([` INFO  ${longMessage}\n       Controller details\n`])
    })

    test('aligns multiline errors after an astral Unicode symbol', () => {
        const output: string[] = []
        const logger = createLogger({ colors: false, write: (value) => output.push(value) })

        logger.error('TypeScript failed\nInspect the diagnostics above')

        expect(output).toEqual([
            '\u258C \u{10102} TypeScript failed\n    Inspect the diagnostics above\n',
        ])
    })
})
