import { expect, test } from 'bun:test'
import {
    inContainer,
    psql,
    shellQuote,
    sqlQuote,
} from '../../../../../../../.github/scripts/ci/fixtures/appliance-storage.ts'
import type { ApplianceCommand } from '../../../../../../../.github/scripts/ci/fixtures/Types/appliance-storage.types.ts'

const rollbackCommand: ApplianceCommand = async (args, timeoutMs) => {
    expect(args.slice(0, 5)).toEqual(['docker', 'exec', 'isolated-fixture', 'bash', '-ceu'])
    expect(timeoutMs).toBe(120_000)
    return 'rollback-result'
}

test('quotes SQL apostrophes independently from shell metacharacters', () => {
    expect(sqlQuote("O'Reilly")).toBe("'O''Reilly'")
    expect(shellQuote("O'Reilly")).toBe("'O'\"'\"'Reilly'")
    expect(shellQuote('$HOME; $(echo synthetic); `echo synthetic`')).toBe(
        "'$HOME; $(echo synthetic); `echo synthetic`'",
    )
})

test('runs fixture SQL with bounded fail-fast psql and a quoted statement', async () => {
    const statement = "select 'O''Reilly; $HOME'::text"
    const command: ApplianceCommand = async (args, timeoutMs) => {
        expect(args.slice(0, 5)).toEqual(['docker', 'exec', 'isolated-fixture', 'sh', '-ceu'])
        expect(args[5]).toContain('--no-password --quiet --set=ON_ERROR_STOP=1')
        expect(args[5]).toContain('--host=127.0.0.1 --username=rentnerproxy')
        expect(args[5]?.endsWith('--command=' + shellQuote(statement))).toBe(true)
        expect(timeoutMs).toBe(60_000)
        return 'fixture-result'
    }
    expect(await psql(command, 'isolated-fixture', statement)).toBe('fixture-result')
})

test('preserves the rollback shell and timeout overrides', async () => {
    expect(await psql(rollbackCommand, 'isolated-fixture', 'select 1', 120_000, 'bash')).toBe(
        'rollback-result',
    )
})

test('propagates command failures instead of accepting empty fixture output', async () => {
    const failure = new Error('isolated command rejected')
    const command: ApplianceCommand = async () => {
        throw failure
    }
    await expect(psql(command, 'isolated-fixture', 'select 1')).rejects.toBe(failure)
    await expect(inContainer(command, 'isolated-fixture', 'true')).rejects.toBe(failure)
})
