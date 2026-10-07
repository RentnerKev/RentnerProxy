import { readFile, writeFile } from 'node:fs/promises'
import { PUBLISHED_RELEASES } from '../../../scripts/compatibility/published-releases.ts'

const policy = 'moderate-and-above; all RustSec/Go findings'

export class AdvisoryPolicyError extends Error {}

const currentImageProfile = {
    profile: 'current',
    cachePackage: 'valkey',
    goBinaries: [
        { name: 'caddy', path: '/usr/bin/caddy' },
        { name: 'crowdsec', path: '/usr/local/bin/crowdsec' },
        { name: 'cscli', path: '/usr/local/bin/cscli' },
    ],
    communityModuleQuery: true,
    cargoLockSourcePath: 'core/Cargo.lock',
} as const

const alpha6ImageProfile = {
    profile: 'published-alpha.6',
    cachePackage: 'redis',
    goBinaries: [{ name: 'caddy', path: '/usr/bin/caddy' }],
    communityModuleQuery: false,
    cargoLockSourcePath: 'controller/Cargo.lock',
} as const

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
        throw new AdvisoryPolicyError(
            `Image advisory policy failed: ${blocked.map((vulnerability) => text(vulnerability.id)).join(', ')}`,
        )
}

export function getImageAssessmentProfile(identity: unknown) {
    const parsed = evaluateIdentity(identity)
    const alpha6 = PUBLISHED_RELEASES['alpha.6']
    const selected =
        parsed.revision === alpha6.revision && parsed.digest === alpha6.digest
            ? alpha6ImageProfile
            : currentImageProfile
    return { ...parsed, ...selected }
}

export function evaluateInventory(report: unknown, identity?: unknown): void {
    const selected =
        identity === undefined ? currentImageProfile : getImageAssessmentProfile(identity)
    const artifacts = array(object(report).artifacts).map(object)
    const names = new Set(
        artifacts.map((artifact) => {
            text(artifact.version)
            return text(artifact.name)
        }),
    )
    for (const name of [
        'bun',
        selected.cachePackage,
        'postgresql-18',
        'github.com/caddyserver/caddy/v2',
        ...(selected.communityModuleQuery ? ['github.com/crowdsecurity/crowdsec'] : []),
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
    const findings = messages.filter((message) =>
        mode === 'query' ? 'osv' in message : 'finding' in message,
    )
    for (const message of messages) {
        if ('error' in message) throw new Error('Go advisory assessment returned an error')
    }
    for (const message of findings) {
        if (mode === 'query') {
            const advisory = object(message.osv)
            text(advisory.id)
            const affected = array(advisory.affected).map(object)
            if (!affected.length) throw new Error('Go advisory affected inventory missing')
            for (const entry of affected) {
                const packageInfo = object(entry.package)
                text(packageInfo.name)
                if (packageInfo.ecosystem !== 'Go')
                    throw new Error('Unexpected Go advisory ecosystem')
                const ranges = array(entry.ranges).map(object)
                if (!ranges.length) throw new Error('Go advisory version ranges missing')
                for (const range of ranges) {
                    if (range.type !== 'SEMVER')
                        throw new Error('Unexpected Go advisory range type')
                    const events = array(range.events).map(object)
                    if (!events.length) throw new Error('Go advisory range events missing')
                    for (const event of events) {
                        const entries = Object.entries(event)
                        if (
                            entries.length !== 1 ||
                            !['introduced', 'fixed', 'last_affected', 'limit'].includes(
                                entries[0]![0],
                            )
                        )
                            throw new Error('Invalid Go advisory range event')
                        text(entries[0]![1])
                    }
                }
            }
        } else {
            const finding = object(message.finding)
            text(finding.osv)
            const trace = array(finding.trace).map(object)
            if (!trace.length) throw new Error('Go advisory trace missing')
            for (const frame of trace) text(frame.module)
        }
    }
    if (findings.length)
        throw new AdvisoryPolicyError(
            'Go advisory policy failed; inspect module and symbol traces in the report',
        )
}

export function evaluateCargoDiagnostics(diagnostics: string): void {
    if (/\b(?:warning|error)\b|couldn't/i.test(diagnostics))
        throw new Error(
            'Cargo audit emitted warnings or errors; advisory/index coverage is incomplete',
        )
}

export function evaluateBunAudit(
    report: unknown,
    scannerStatus: number,
    diagnostics: string,
): void {
    if (scannerStatus !== 0 && scannerStatus !== 1)
        throw new Error('Unexpected Bun audit exit status')
    // Bun can retain JSON from one registry while warning that another was
    // unaudited. Neither partial coverage nor transport errors are a verdict.
    if (diagnostics.trim()) throw new Error('Bun audit coverage is incomplete')
    let blocked = false
    for (const [packageName, entries] of Object.entries(object(report))) {
        text(packageName)
        const advisories = array(entries).map(object)
        if (!advisories.length) throw new Error('Empty Bun advisory package entry')
        for (const advisory of advisories) {
            const id = advisory.id
            if (typeof id === 'number') {
                if (!Number.isSafeInteger(id) || id < 1)
                    throw new Error('Invalid Bun advisory identifier')
            } else text(id)
            text(advisory.title)
            text(advisory.vulnerable_versions)
            if (new URL(text(advisory.url)).protocol !== 'https:')
                throw new Error('Invalid Bun advisory URL')
            const severity = text(advisory.severity)
            if (!['info', 'low', 'moderate', 'high', 'critical'].includes(severity))
                throw new Error('Unknown Bun advisory severity')
            if (['moderate', 'high', 'critical'].includes(severity)) blocked = true
        }
    }
    // --json includes advisories below --audit-level. The raw exit must agree
    // with the validated moderate-and-above findings before classification.
    if (scannerStatus !== Number(blocked))
        throw new Error('Bun audit report and exit status are inconsistent')
    if (blocked) throw new AdvisoryPolicyError('Locked JavaScript graph contains an advisory')
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
    const findings = array(vulnerabilities.list).map(object)
    if (
        count !== findings.length ||
        (vulnerabilities.found !== undefined && vulnerabilities.found !== count > 0)
    )
        throw new Error('Cargo advisory findings and count are inconsistent')
    for (const finding of findings) text(object(finding.advisory).id)
    if (findings.length)
        throw new AdvisoryPolicyError('Locked Cargo graph contains a RustSec vulnerability')
}

export function evaluateIdentity(report: unknown): { revision: string; digest: string } {
    const parsed = object(report)
    const revision = text(parsed.revision)
    const digest = text(parsed.digest)
    if (!/^[0-9a-f]{40}$/.test(revision) || !/^sha256:[0-9a-f]{64}$/.test(digest))
        throw new Error('Invalid immutable source/image identity')
    return { revision, digest }
}

export function evaluateApprovedAssessment(
    report: unknown,
    expected: unknown,
    now = Date.now(),
): void {
    const parsed = object(report)
    const actual = evaluateIdentity(parsed)
    const identity = evaluateIdentity(expected)
    if (
        parsed.verdict !== 'approved' ||
        parsed.policy !== policy ||
        actual.revision !== identity.revision ||
        actual.digest !== identity.digest
    )
        throw new Error('Publication requires an approved assessment for the exact candidate')
    fresh(parsed.assessedAt, now, 3_600_000)
}

if (import.meta.main) {
    try {
        const [mode, path, output, diagnosticsPath] = process.argv.slice(2)
        if (!path) throw new Error('A structured scanner report is required')
        if (mode === 'cargo-diagnostics') {
            evaluateCargoDiagnostics(await readFile(path, 'utf8'))
            process.exit(0)
        }
        const report: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (mode === 'database') evaluateDatabase(report)
        else if (mode === 'image') evaluateImage(report)
        else if (mode === 'profile' && output)
            await writeFile(output, JSON.stringify(getImageAssessmentProfile(report), null, 2))
        else if (mode === 'inventory')
            evaluateInventory(
                report,
                output ? (JSON.parse(await readFile(output, 'utf8')) as unknown) : undefined,
            )
        else if (mode === 'binary' || mode === 'query') evaluateGo(report, mode)
        else if (mode === 'bun-audit' && output !== undefined && diagnosticsPath) {
            if (!/^[01]$/.test(output)) throw new Error('Unexpected Bun audit exit status')
            evaluateBunAudit(report, Number(output), await readFile(diagnosticsPath, 'utf8'))
        } else if (mode === 'cargo' && output)
            evaluateCargo(report, JSON.parse(await readFile(output, 'utf8')) as unknown)
        else if ((mode === 'identity' || mode === 'blocked') && output) {
            const parsed = evaluateIdentity(report)
            await writeFile(
                output,
                JSON.stringify(
                    {
                        ...parsed,
                        policy,
                        verdict: mode === 'identity' ? 'approved' : 'blocked',
                        assessedAt: new Date().toISOString(),
                    },
                    null,
                    2,
                ),
            )
        } else if (mode === 'approved' && output)
            evaluateApprovedAssessment(
                report,
                JSON.parse(await readFile(output, 'utf8')) as unknown,
            )
        else throw new Error('Unknown policy mode')
    } catch (error) {
        // A completed adverse assessment is distinct from unavailable or invalid
        // evidence. Both remain nonzero for every publication caller.
        if (error instanceof AdvisoryPolicyError) {
            console.error(error.message)
            process.exit(3)
        }
        throw error
    }
}
