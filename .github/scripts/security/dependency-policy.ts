import { readFile, writeFile } from 'node:fs/promises'

const policy = 'moderate-and-above Bun; all RustSec findings'
const scope = 'rentnerproxy-locked-cargo-and-bun'

export class AdvisoryPolicyError extends Error {}

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

function evaluateAssessment(
    report: unknown,
    expected: unknown,
    verdict: 'own-dependencies-approved' | 'blocked',
    now: number,
): void {
    const parsed = object(report)
    const actual = evaluateIdentity(parsed)
    const identity = evaluateIdentity(expected)
    if (
        parsed.verdict !== verdict ||
        parsed.policy !== policy ||
        parsed.scope !== scope ||
        parsed.externalRuntimePolicy !== 'informational' ||
        actual.revision !== identity.revision ||
        actual.digest !== identity.digest
    )
        throw new Error('An own-dependency assessment for the exact candidate is required')
    fresh(parsed.assessedAt, now, 3_600_000)
}

export function evaluateApprovedAssessment(
    report: unknown,
    expected: unknown,
    now = Date.now(),
): void {
    evaluateAssessment(report, expected, 'own-dependencies-approved', now)
}

export function evaluateBlockedAssessment(
    report: unknown,
    expected: unknown,
    now = Date.now(),
): void {
    evaluateAssessment(report, expected, 'blocked', now)
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
        if (mode === 'bun-audit' && output !== undefined && diagnosticsPath) {
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
                        scope,
                        externalRuntimePolicy: 'informational',
                        verdict: mode === 'identity' ? 'own-dependencies-approved' : 'blocked',
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
        else if (mode === 'blocked-assessment' && output)
            evaluateBlockedAssessment(report, JSON.parse(await readFile(output, 'utf8')) as unknown)
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
