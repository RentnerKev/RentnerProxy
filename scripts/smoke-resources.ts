export const SMOKE_RUN_LABEL = 'io.rentnerproxy.smoke-run'

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

function labelsWithSmokeRun(value: unknown, scope: string): Record<string, string> {
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
    if (value && typeof value === 'object') {
        return { ...(value as Record<string, string>), [SMOKE_RUN_LABEL]: scope }
    }
    return { [SMOKE_RUN_LABEL]: scope }
}

function addLabels(target: Record<string, any>, scope: string): void {
    target.labels = labelsWithSmokeRun(target.labels, scope)
}

/**
 * Add the CI scope to directly-created Docker resources. Commands that are
 * not resource creation commands are returned unchanged so inspection and
 * teardown continue to address the resource by their existing identifiers.
 */
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

/** Add the CI scope to Compose services, built images, named volumes, and the default network. */
export function smokeCompose(source: string): string {
    const scope = smokeRunScope()
    if (!scope) return source

    const document = Bun.YAML.parse(source) as Record<string, any>
    const services = document.services
    if (services && typeof services === 'object' && !Array.isArray(services)) {
        for (const service of Object.values(services)) {
            if (!service || typeof service !== 'object' || Array.isArray(service)) continue
            const serviceRecord = service as Record<string, any>
            addLabels(serviceRecord, scope)
            if (
                serviceRecord.build &&
                typeof serviceRecord.build === 'object' &&
                !Array.isArray(serviceRecord.build)
            ) {
                addLabels(serviceRecord.build as Record<string, any>, scope)
            }
        }
    }

    const volumes = document.volumes
    if (volumes && typeof volumes === 'object' && !Array.isArray(volumes)) {
        for (const [name, volume] of Object.entries(volumes)) {
            if (volume === null) {
                volumes[name] = { labels: { [SMOKE_RUN_LABEL]: scope } }
                continue
            }
            if (volume && typeof volume === 'object' && !Array.isArray(volume)) {
                const volumeRecord = volume as Record<string, any>
                if (volumeRecord.external) continue
                addLabels(volumeRecord, scope)
            }
        }
    }

    const networks =
        document.networks &&
        typeof document.networks === 'object' &&
        !Array.isArray(document.networks)
            ? document.networks
            : (document.networks = {})
    const defaultNetwork =
        networks.default && typeof networks.default === 'object' && !Array.isArray(networks.default)
            ? networks.default
            : (networks.default = {})
    if (!(defaultNetwork as Record<string, any>).external) {
        addLabels(defaultNetwork as Record<string, any>, scope)
    }

    return JSON.stringify(document, null, 2) + '\n'
}
