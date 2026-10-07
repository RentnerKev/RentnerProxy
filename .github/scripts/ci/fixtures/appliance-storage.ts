import type { ApplianceCommand } from './Types/appliance-storage.types.ts'

export function shellQuote(value: string): string {
    return "'" + value.replaceAll("'", "'\"'\"'") + "'"
}

export function sqlQuote(value: string): string {
    return "'" + value.replaceAll("'", "''") + "'"
}

export function inContainer(
    command: ApplianceCommand,
    containerId: string,
    script: string,
    timeoutMs = 60_000,
    shell: 'sh' | 'bash' = 'sh',
): Promise<string> {
    return command(['docker', 'exec', containerId, shell, '-ceu', script], timeoutMs)
}

export function psql(
    command: ApplianceCommand,
    containerId: string,
    statement: string,
    timeoutMs = 60_000,
    shell: 'sh' | 'bash' = 'sh',
): Promise<string> {
    const script =
        'PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql ' +
        '--no-psqlrc --no-password --quiet --set=ON_ERROR_STOP=1 ' +
        '--tuples-only --no-align --host=127.0.0.1 --username=rentnerproxy ' +
        '--dbname=rentnerproxy --command=' +
        shellQuote(statement)
    return inContainer(command, containerId, script, timeoutMs, shell)
}
