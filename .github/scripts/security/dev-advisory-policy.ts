import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

import {
    AdvisoryPolicyError,
    evaluateGo,
    evaluateIdentity,
    evaluateImage,
} from './dependency-policy.ts'

type ImageRule = {
    id: string
    namespace: string
    severity: string
    fixState: string
    name: string
    version: string
    type: string
    purl: string
    paths: string[]
    maxMatches: number
}
type GoRule = {
    binary: string
    id: string
    module: string
    version: string
    packagePrefix: string
    maxFindings: number
}
export type DevAcceptance = {
    schemaVersion: number
    repository: string
    issuedAt: string
    expiresAt: string
    evidenceRun: string | number
    evidenceSha256: string
    reason: string
    imageRules: ImageRule[]
    goRules: GoRule[]
}
export type DevContext = {
    repository: string
    eventName: string
    ref: string
    workflowRef: string
    workflowSha: string
    jobWorkflowRef: string
    jobWorkflowSha: string
    stage: string
    image: string
    tags: string
    acknowledgement: string
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected structured dev evidence')
    return value as Record<string, unknown>
}
function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new Error('Expected dev evidence array')
    return value as unknown[]
}
function text(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new Error('Expected dev evidence string')
    return value
}
function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
        throw new Error('Invalid dev acceptance bound')
    return value
}
function paths(value: unknown): string[] {
    const result = array(value).map(text).toSorted()
    if (!result.length || result.some((path) => !path.startsWith('/')))
        throw new Error('Dev acceptance requires exact artifact paths')
    return [...new Set(result)]
}
function imageKey(rule: Omit<ImageRule, 'maxMatches'>): string {
    return JSON.stringify([
        rule.id,
        rule.namespace,
        rule.severity,
        rule.fixState,
        rule.name,
        rule.version,
        rule.type,
        rule.purl,
        rule.paths.toSorted(),
    ])
}

export function evaluateDevContext(context: DevContext, acceptance: DevAcceptance): void {
    const caller = `${acceptance.repository}/.github/workflows/dev-image.yml@refs/heads/main`
    const job =
        context.stage === 'build'
            ? caller
            : `${acceptance.repository}/.github/workflows/publish-assessed-image.yml@refs/heads/main`
    if (
        acceptance.repository !== 'RentnerKev/RentnerProxy' ||
        context.acknowledgement !== 'true' ||
        !['build', 'publish'].includes(context.stage) ||
        context.repository !== acceptance.repository ||
        context.eventName !== 'workflow_dispatch' ||
        context.ref !== 'refs/heads/main' ||
        context.workflowRef !== caller ||
        context.jobWorkflowRef !== job ||
        !/^[0-9a-f]{40}$/.test(context.workflowSha) ||
        context.jobWorkflowSha !== context.workflowSha ||
        context.image !== `ghcr.io/${acceptance.repository.toLowerCase()}` ||
        context.tags.trim() !== 'dev'
    )
        throw new Error(
            'Known advisory acceptance requires the manually acknowledged main :dev workflow',
        )
}

export function evaluateDevAcceptance(value: unknown, now = Date.now()): DevAcceptance {
    const parsed = object(value)
    const issuedAt = text(parsed.issuedAt)
    const expiresAt = text(parsed.expiresAt)
    const start = Date.parse(issuedAt)
    const end = Date.parse(expiresAt)
    if (
        parsed.schemaVersion !== 1 ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > now + 300_000 ||
        end <= now ||
        end <= start ||
        end - start > 604_800_000
    )
        throw new Error('Known dev advisory acceptance is invalid or expired')
    if (!/^[0-9a-f]{64}$/.test(text(parsed.evidenceSha256)))
        throw new Error('Missing immutable prior advisory evidence')
    if (!/^[1-9][0-9]*$/.test(String(parsed.evidenceRun)))
        throw new Error('Missing prior assessment run')
    text(parsed.reason)
    const imageRules = array(parsed.imageRules).map((entry) => {
        const rule = object(entry)
        const result: ImageRule = {
            id: text(rule.id),
            namespace: text(rule.namespace),
            severity: text(rule.severity),
            fixState: text(rule.fixState),
            name: text(rule.name),
            version: text(rule.version),
            type: text(rule.type),
            purl: text(rule.purl),
            paths: paths(rule.paths),
            maxMatches: count(rule.maxMatches),
        }
        if (
            !['deb', 'go-module'].includes(result.type) ||
            !['Medium', 'High', 'Critical'].includes(result.severity) ||
            !['not-fixed', 'wont-fix'].includes(result.fixState) ||
            !result.purl.startsWith(result.type === 'deb' ? 'pkg:deb/debian/' : 'pkg:golang/')
        )
            throw new Error('Invalid known dev image advisory rule')
        return result
    })
    if (new Set(imageRules.map(imageKey)).size !== imageRules.length)
        throw new Error('Duplicate known dev image advisory rule')
    const goRules = array(parsed.goRules).map((entry) => {
        const rule = object(entry)
        const result: GoRule = {
            binary: text(rule.binary),
            id: text(rule.id),
            module: text(rule.module),
            version: text(rule.version),
            packagePrefix: text(rule.packagePrefix),
            maxFindings: count(rule.maxFindings),
        }
        if (
            !['caddy', 'crowdsec', 'cscli'].includes(result.binary) ||
            !/^GO-\d{4}-\d+$/.test(result.id) ||
            !result.packagePrefix.startsWith(result.module)
        )
            throw new Error('Invalid known dev Go advisory rule')
        return result
    })
    if (new Set(goRules.map((rule) => `${rule.binary}:${rule.id}`)).size !== goRules.length)
        throw new Error('Duplicate known dev Go advisory rule')
    return {
        schemaVersion: 1,
        repository: text(parsed.repository),
        issuedAt,
        expiresAt,
        evidenceRun: String(parsed.evidenceRun),
        evidenceSha256: text(parsed.evidenceSha256),
        reason: text(parsed.reason),
        imageRules,
        goRules,
    }
}

function validateComplete(assessment: () => void): void {
    try {
        assessment()
    } catch (error) {
        // Only validated adverse findings can enter the exact-match comparison.
        // Missing inventory, scanner errors and stale databases still fail.
        if (!(error instanceof AdvisoryPolicyError)) throw error
    }
}

export function evaluateDevImage(report: unknown, acceptance: DevAcceptance): number {
    validateComplete(() => evaluateImage(report))
    const allowed = new Map(acceptance.imageRules.map((rule) => [imageKey(rule), rule]))
    const used = new Map<string, number>()
    for (const entry of array(object(report).matches)) {
        const match = object(entry)
        const vulnerability = object(match.vulnerability)
        const severity = text(vulnerability.severity)
        if (['negligible', 'low'].includes(severity.toLowerCase())) continue
        const artifact = object(match.artifact)
        const fix = object(vulnerability.fix)
        if (array(fix.versions).length)
            throw new AdvisoryPolicyError('A dev advisory with an available fix cannot be accepted')
        const key = imageKey({
            id: text(vulnerability.id),
            namespace: text(vulnerability.namespace),
            severity,
            fixState: text(fix.state),
            name: text(artifact.name),
            version: text(artifact.version),
            type: text(artifact.type),
            purl: text(artifact.purl),
            paths: paths(array(artifact.locations).map((location) => object(location).path)),
        })
        const rule = allowed.get(key)
        const occurrences = (used.get(key) ?? 0) + 1
        if (!rule || occurrences > rule.maxMatches)
            throw new AdvisoryPolicyError(
                `Unaccepted dev image advisory: ${text(vulnerability.id)}`,
            )
        used.set(key, occurrences)
    }
    return [...used.values()].reduce((total, value) => total + value, 0)
}

export function evaluateDevGo(
    report: unknown,
    binary: string,
    acceptance: DevAcceptance,
    now = Date.now(),
): number {
    validateComplete(() => evaluateGo(report, 'binary', now))
    const used = new Map<string, number>()
    for (const entry of array(report)
        .map(object)
        .filter((message) => 'finding' in message)) {
        const finding = object(entry.finding)
        const id = text(finding.osv)
        if (finding.fixed_version !== undefined && typeof finding.fixed_version !== 'string')
            throw new Error('Invalid Go advisory fixed version')
        if (finding.fixed_version)
            throw new AdvisoryPolicyError(
                'A dev Go advisory with an available fix cannot be accepted',
            )
        const rule = acceptance.goRules.find(
            (candidate) => candidate.binary === binary && candidate.id === id,
        )
        const occurrences = (used.get(id) ?? 0) + 1
        if (!rule || occurrences > rule.maxFindings)
            throw new AdvisoryPolicyError(`Unaccepted dev ${binary} advisory: ${id}`)
        for (const frame of array(finding.trace).map(object)) {
            if (
                frame.module !== rule.module ||
                frame.version !== rule.version ||
                (frame.package !== undefined &&
                    frame.package !== rule.packagePrefix &&
                    !text(frame.package).startsWith(`${rule.packagePrefix}/`))
            )
                throw new AdvisoryPolicyError(`Unaccepted dev ${binary} module or package: ${id}`)
        }
        used.set(id, occurrences)
    }
    return [...used.values()].reduce((total, value) => total + value, 0)
}

export function evaluateDevAssessment(
    report: unknown,
    expected: unknown,
    acceptance: DevAcceptance,
    acceptanceSha256: string,
    now = Date.now(),
): void {
    const parsed = object(report)
    const actual = evaluateIdentity(parsed)
    const identity = evaluateIdentity(expected)
    const age = now - Date.parse(text(parsed.assessedAt))
    if (
        parsed.verdict !== 'dev-risk-accepted' ||
        parsed.policy !== 'explicit-known-advisories; dev-only' ||
        parsed.acceptanceSha256 !== acceptanceSha256 ||
        parsed.expiresAt !== acceptance.expiresAt ||
        actual.revision !== identity.revision ||
        actual.digest !== identity.digest ||
        !Number.isFinite(age) ||
        age < -300_000 ||
        age > 3_600_000
    )
        throw new Error('Dev publication requires fresh acceptance for the exact candidate')
    const accepted = count(parsed.acceptedFindings)
    const maximum =
        acceptance.imageRules.reduce((sum, rule) => sum + rule.maxMatches, 0) +
        acceptance.goRules.reduce((sum, rule) => sum + rule.maxFindings, 0)
    if (accepted > maximum)
        throw new Error('Dev accepted finding count exceeds the reviewed bounds')
}

async function runCli(): Promise<void> {
    const [mode, path, output] = process.argv.slice(2)
    if (!path) throw new Error('Dev assessment path is required')
    const acceptancePath = new URL('./dev-advisory-acceptance.json', import.meta.url)
    const rawAcceptance = await readFile(acceptancePath, 'utf8')
    const acceptance = evaluateDevAcceptance(JSON.parse(rawAcceptance) as unknown)
    const acceptanceSha256 = createHash('sha256').update(rawAcceptance).digest('hex')
    const env = process.env
    evaluateDevContext(
        {
            repository: env.GITHUB_REPOSITORY ?? '',
            eventName: env.GITHUB_EVENT_NAME ?? '',
            ref: env.GITHUB_REF ?? '',
            workflowRef: env.GITHUB_WORKFLOW_REF ?? '',
            workflowSha: env.GITHUB_WORKFLOW_SHA ?? '',
            jobWorkflowRef: env.DEV_JOB_WORKFLOW_REF ?? '',
            jobWorkflowSha: env.DEV_JOB_WORKFLOW_SHA ?? '',
            stage: env.DEV_ASSESSMENT_STAGE ?? '',
            image: env.IMAGE ?? '',
            tags: env.IMAGE_TAGS ?? '',
            acknowledgement: env.ACCEPT_KNOWN_DEV_ADVISORIES ?? '',
        },
        acceptance,
    )
    if (mode === 'context') process.exit(0)
    const report: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (mode === 'image') {
        console.log(evaluateDevImage(report, acceptance))
    } else if (mode === 'binary' && output) {
        console.log(evaluateDevGo(report, output, acceptance))
    } else if (mode === 'record' && output) {
        const total = count(Number(env.DEV_ACCEPTED_FINDINGS))
        await writeFile(
            output,
            JSON.stringify(
                {
                    ...evaluateIdentity(report),
                    policy: 'explicit-known-advisories; dev-only',
                    verdict: 'dev-risk-accepted',
                    acceptanceSha256,
                    expiresAt: acceptance.expiresAt,
                    acceptedFindings: total,
                    assessedAt: new Date().toISOString(),
                },
                null,
                2,
            ),
        )
        console.error(
            `::warning::DEV ONLY: ${total} known findings explicitly accepted until ${acceptance.expiresAt}; this image is not security approved.`,
        )
    } else if (mode === 'accepted' && output) {
        evaluateDevAssessment(
            report,
            JSON.parse(await readFile(output, 'utf8')) as unknown,
            acceptance,
            acceptanceSha256,
        )
    } else throw new Error('Unknown dev advisory mode')
}

if (import.meta.main) {
    try {
        await runCli()
    } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exit(error instanceof AdvisoryPolicyError ? 3 : 1)
    }
}
