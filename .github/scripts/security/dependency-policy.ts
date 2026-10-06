import { readFile, writeFile } from 'node:fs/promises'

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected a structured report object')
    return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('Expected a structured report array')
    return value as unknown[]
}

function text(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new Error('Expected a nonempty report string')
    return value
}

function fresh(value: unknown, now: number, maximumAge: number): void {
    const age = now - Date.parse(text(value))
    if (!Number.isFinite(age) || age < -300_000 || age > maximumAge)
        throw new Error('Advisory database timestamp missing, invalid or stale')
}

export function evaluateDatabase(report: unknown, now = Date.now()): void {
    const parsed = object(report)
    if (parsed.valid !== true || parsed.error) throw new Error('Invalid Grype advisory database')
    text(parsed.schemaVersion)
    fresh(parsed.built, now, 172_800_000)
}

export function evaluateImage(report: unknown): void {
    const parsed = object(report)
    const descriptor = object(parsed.descriptor)
    if (descriptor.name !== 'grype' || descriptor.version !== '0.120.0')
        throw new Error('Unexpected image scanner identity')
    if (object(parsed.distro).name !== 'debian')
        throw new Error('OS inventory missing or unexpected')
    if (parsed.ignoredMatches !== undefined && array(parsed.ignoredMatches).length)
        throw new Error('Ignored vulnerability matches are forbidden')
    const blocked = array(parsed.matches)
        .map((entry) => object(object(entry).vulnerability))
        .filter((vulnerability) => {
            text(vulnerability.id)
            return !['negligible', 'low'].includes(text(vulnerability.severity).toLowerCase())
        })
    if (blocked.length)
        throw new Error(
            `Image advisory policy failed: ${blocked.map((vulnerability) => text(vulnerability.id)).join(', ')}`,
        )
}

export function evaluateInventory(report: unknown): void {
    const artifacts = array(object(report).artifacts).map(object)
    const names = new Set(
        artifacts.map((artifact) => {
            text(artifact.version)
            return text(artifact.name)
        }),
    )
    for (const name of [
        'bun',
        'valkey',
        'postgresql-18',
        'github.com/caddyserver/caddy/v2',
        'github.com/crowdsecurity/crowdsec',
    ]) {
        if (!names.has(name)) throw new Error(`Incomplete runtime inventory: ${name}`)
    }
    if (!artifacts.some((artifact) => artifact.type === 'deb'))
        throw new Error('OS inventory missing')
    if (!artifacts.some((artifact) => artifact.type === 'npm'))
        throw new Error('JavaScript inventory missing')
}

export function evaluateGo(report: unknown, mode: 'binary' | 'query', now = Date.now()): void {
    const messages = array(report).map(object)
    const config = object(messages[0]?.config)
    if (
        config.protocol_version !== 'v1.0.0' ||
        config.scanner_name !== 'govulncheck' ||
        config.scan_mode !== mode
    )
        throw new Error('Unexpected Go scanner identity or mode')
    if (config.scanner_version !== 'v1.8.0' || config.db !== 'https://vuln.go.dev')
        throw new Error('Unexpected Go scanner version or advisory source')
    fresh(config.db_last_modified, now, 604_800_000)
    if (mode === 'binary') {
        if (config.scan_level !== 'symbol')
            throw new Error('Go symbol reachability assessment missing')
        const inventory = messages.find((message) => message.SBOM)
        if (!inventory || !array(object(inventory.SBOM).modules).length)
            throw new Error('Go binary inventory missing')
    }
    // Query OSVs apply to the queried version. Retain every binary module,
    // package and symbol trace, and conservatively block non-reachable findings.
    if (messages.some((message) => (mode === 'query' ? message.osv : message.finding)))
        throw new Error('Go advisory policy failed; inspect module and symbol traces in the report')
}

export function evaluateCargoDiagnostics(diagnostics: string): void {
    if (/\b(?:warning|error)\b|couldn't/i.test(diagnostics))
        throw new Error(
            'Cargo audit emitted warnings or errors; advisory/index coverage is incomplete',
        )
}

export function evaluateCargo(report: unknown, databaseEvidence: unknown, now = Date.now()): void {
    const parsed = object(report)
    const database = object(parsed.database)
    const evidence = object(databaseEvidence)
    const revision = text(evidence.revision)
    if (!/^[0-9a-f]{40}$/.test(revision) || database['last-commit'] !== revision)
        throw new Error('Cargo advisory database metadata does not match the assessed Git revision')
    fresh(evidence.fetchedAt, now, 172_800_000)
    fresh(database['last-updated'], now, 604_800_000)
    if (typeof database['advisory-count'] !== 'number' || database['advisory-count'] < 1)
        throw new Error('Cargo advisory database is empty')
    const dependencyCount = object(parsed.lockfile)['dependency-count']
    if (typeof dependencyCount !== 'number' || dependencyCount < 1)
        throw new Error('Cargo locked graph is empty')
    const settings = object(parsed.settings)
    if (
        array(settings.ignore).length ||
        array(settings.target_arch).length ||
        array(settings.target_os).length ||
        settings.severity !== null
    )
        throw new Error('Cargo advisory coverage is filtered')
    if (Object.values(object(parsed.warnings)).some((warnings) => array(warnings).length))
        throw new Error('Cargo advisory or yanked-package warnings')
    const vulnerabilities = object(parsed.vulnerabilities)
    const count = vulnerabilities.count
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0)
        throw new Error('Cargo advisory count missing')
    if (count || array(vulnerabilities.list).length)
        throw new Error('Locked Cargo graph contains a RustSec vulnerability')
}

export function evaluateIdentity(report: unknown): { revision: string; digest: string } {
    const parsed = object(report)
    const revision = text(parsed.revision)
    const digest = text(parsed.digest)
    if (!/^[0-9a-f]{40}$/.test(revision) || !/^sha256:[0-9a-f]{64}$/.test(digest))
        throw new Error('Invalid immutable source/image identity')
    return { revision, digest }
}

if (import.meta.main) {
    const [mode, path, output] = process.argv.slice(2)
    if (!path) throw new Error('A structured scanner report is required')
    if (mode === 'cargo-diagnostics') {
        evaluateCargoDiagnostics(await readFile(path, 'utf8'))
        process.exit(0)
    }
    const report: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (mode === 'database') evaluateDatabase(report)
    else if (mode === 'image') evaluateImage(report)
    else if (mode === 'inventory') evaluateInventory(report)
    else if (mode === 'binary' || mode === 'query') evaluateGo(report, mode)
    else if (mode === 'cargo' && output)
        evaluateCargo(report, JSON.parse(await readFile(output, 'utf8')) as unknown)
    else if (mode === 'identity' && output) {
        const parsed = evaluateIdentity(report)
        await writeFile(
            output,
            JSON.stringify(
                {
                    ...parsed,
                    policy: 'moderate-and-above; all RustSec/Go findings',
                    assessedAt: new Date().toISOString(),
                },
                null,
                2,
            ),
        )
    } else throw new Error('Unknown policy mode')
}
