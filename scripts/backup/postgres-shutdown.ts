export function postgresShutdownScript(graceSeconds = 5): string {
    if (!Number.isSafeInteger(graceSeconds) || graceSeconds < 1 || graceSeconds > 30)
        throw new Error('Invalid PostgreSQL shutdown grace')
    return [
        'stop_postgres() {',
        '    local deadline=$((SECONDS + ' + graceSeconds + '))',
        '    kill -TERM "$postgres_pid" 2>/dev/null || true',
        '    while kill -0 "$postgres_pid" 2>/dev/null && ((SECONDS < deadline)); do sleep 0.1; done',
        '    if kill -0 "$postgres_pid" 2>/dev/null; then kill -KILL "$postgres_pid" 2>/dev/null || true; fi',
        '    wait "$postgres_pid" 2>/dev/null || true',
        '}',
    ].join('\n')
}
