export const SMOKE_RUN_LABEL = 'io.rentnerproxy.smoke-run'

const RESTORE_SMOKE_OPERATIONS = [
    'inspect controller state archive',
    'validate controller state archive types',
    'initialize restore target',
    'quiesce restore target',
    'stage application encryption key restore',
    'restore PostgreSQL',
    'restore controller state',
    'complete application encryption key restore',
    'start restored appliance',
    'stage production restore',
    'inspect pending restore',
    'restore managed CrowdSec state',
    'flush restored state',
    'complete production restore',
] as const

const restoreValidationPattern =
    /Backup validation: (database_version|migration_history|application_key|crowdsec_archive|crowdsec_database|crowdsec_credentials|runtime_validation)(?:;|\.)/u

const restoreDatabaseDetailsPattern =
    /Restore database phase: (initialize|archive|render|assemble|execute)(?:; SQLSTATE: (23514|42P01|3F000|42501|42601|42710|2BP01|25P02))?\./u

export function restoreSmokeDiagnostic(output: string): string | undefined {
    const operation = RESTORE_SMOKE_OPERATIONS.find((name) =>
        output.includes('production restore operation failed: ' + name + '.'),
    )
    if (operation === undefined) return undefined
    const details =
        operation === 'restore PostgreSQL' ? output.match(restoreDatabaseDetailsPattern) : null
    const validation =
        operation === 'restore PostgreSQL' ? output.match(restoreValidationPattern)?.[1] : undefined
    return (
        'Restore failed: ' +
        operation +
        (details ? ' (' + details[1] + (details[2] ? '; SQLSTATE: ' + details[2] : '') + ')' : '') +
        (validation ? ' [validation: ' + validation + ']' : '')
    )
}

export function isRestoreSmokeDiagnostic(line: string): boolean {
    if (line.includes(' [validation: ')) {
        const match =
            /^(.*?) \[validation: (database_version|migration_history|application_key|crowdsec_archive|crowdsec_database|crowdsec_credentials|runtime_validation)\]$/u.exec(
                line,
            )
        return match !== null && isRestoreSmokeDiagnostic(match[1]!)
    }
    return (
        RESTORE_SMOKE_OPERATIONS.some((name) => line === 'Restore failed: ' + name) ||
        /^Restore failed: restore PostgreSQL \((initialize|archive|render|assemble|execute)(?:; SQLSTATE: (23514|42P01|3F000|42501|42601|42710|2BP01|25P02))?\)$/u.test(
            line,
        )
    )
}

const smokeRunScopePattern = /^(?:[0-9]+-[0-9]+|local-[a-f0-9]{12})$/u
const smokeRunScopeMaxLength = 80

export function smokeRunScope(): string | undefined {
    const value = process.env.RENTNERPROXY_SMOKE_RUN
    if (value === undefined || value === '') return undefined
    if (value.length > smokeRunScopeMaxLength || !smokeRunScopePattern.test(value)) {
        throw new Error('RENTNERPROXY_SMOKE_RUN has an invalid smoke resource scope')
    }
    return value
}

function labelsWithSmokeRun(value: unknown, scope: string): Record<string, unknown> {
    if (Array.isArray(value)) {
        const labels: Record<string, string> = {}
        for (const entry of value) {
            if (typeof entry !== 'string') continue
            const separator = entry.indexOf('=')
            if (separator === -1) labels[entry] = ''
            else labels[entry.slice(0, separator)] = entry.slice(separator + 1)
        }
        labels[SMOKE_RUN_LABEL] = scope
        return labels
    }
    if (isRecord(value)) {
        return { ...value, [SMOKE_RUN_LABEL]: scope }
    }
    return { [SMOKE_RUN_LABEL]: scope }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function addLabels(target: Record<string, unknown>, scope: string): void {
    target.labels = labelsWithSmokeRun(target.labels, scope)
}

export function smokeDockerArguments(argumentsList: readonly string[]): string[] {
    const scope = smokeRunScope()
    const args = [...argumentsList]
    if (!scope || args[0] !== 'docker') return args

    const label = SMOKE_RUN_LABEL + '=' + scope
    const subcommand = args[1]
    const insertion =
        subcommand === 'run' ||
        subcommand === 'create' ||
        subcommand === 'build' ||
        (subcommand === 'network' && args[2] === 'create') ||
        (subcommand === 'volume' && args[2] === 'create')

    if (!insertion) return args
    const index = subcommand === 'network' || subcommand === 'volume' ? 3 : 2
    args.splice(index, 0, '--label', label)
    return args
}

export function smokeCompose(source: string): string {
    const scope = smokeRunScope()
    if (!scope) return source

    const document: unknown = Bun.YAML.parse(source)
    if (!isRecord(document)) throw new Error('Smoke Compose must be an object')
    const services = document.services
    if (isRecord(services)) {
        for (const service of Object.values(services)) {
            if (!service || typeof service !== 'object' || Array.isArray(service)) continue
            const serviceRecord = service as Record<string, unknown>
            addLabels(serviceRecord, scope)
            if (
                serviceRecord.build &&
                typeof serviceRecord.build === 'object' &&
                !Array.isArray(serviceRecord.build)
            ) {
                addLabels(serviceRecord.build as Record<string, unknown>, scope)
            }
        }
    }

    const volumes = document.volumes
    if (isRecord(volumes)) {
        for (const [name, volume] of Object.entries(volumes)) {
            if (volume === null) {
                volumes[name] = { labels: { [SMOKE_RUN_LABEL]: scope } }
                continue
            }
            if (volume && typeof volume === 'object' && !Array.isArray(volume)) {
                const volumeRecord = volume as Record<string, unknown>
                if (volumeRecord.external) continue
                addLabels(volumeRecord, scope)
            }
        }
    }

    const networks = isRecord(document.networks) ? document.networks : (document.networks = {})
    const defaultNetwork = isRecord(networks.default) ? networks.default : (networks.default = {})
    if (!(defaultNetwork as Record<string, unknown>).external) {
        addLabels(defaultNetwork as Record<string, unknown>, scope)
    }

    return JSON.stringify(document, null, 2) + '\n'
}
