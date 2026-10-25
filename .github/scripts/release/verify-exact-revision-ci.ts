import { readBoundedStream } from '../../../web/src/lib/Http/readBoundedStream.ts'
import type { CiGetJson, ReleaseCiJob, ReleaseCiRun } from './Types/exact-revision-ci.types.ts'

export const CI_GATE_ERROR = 'Exact release revision CI verification failed.'
export const REQUIRED_CI_JOBS = [
    'Format',
    'Lint',
    'Script Typecheck',
    'Web Tests',
    'Fuzz Tests',
    'Rust',
    'Build',
    'Caddy Response Cache',
] as const
const REPOSITORY = 'rentnerkev/rentnerproxy'
const API_PATH = `/repos/${REPOSITORY}/actions`
export const REQUIRED_COMPATIBILITY_JOBS = ['Compatibility verified'] as const
const REQUIRED_WORKFLOWS = [
    { filename: 'ci.yml', jobs: REQUIRED_CI_JOBS },
    { filename: 'release-compatibility.yml', jobs: REQUIRED_COMPATIBILITY_JOBS },
] as const
const MAX_PAGES = 10
const MAX_ITEMS = 1_000
export const MAX_CI_RESPONSE_BYTES = 8 * 1024 * 1024

function fail(): never {
    throw new Error(CI_GATE_ERROR)
}
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
    return value as Record<string, unknown>
}
function integer(value: unknown, minimum = 1): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return fail()
    return value
}
function text(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 256 ||
        /[\r\n\0]/.test(value)
    )
        return fail()
    return value
}
function nullableText(value: unknown): string | null {
    return value === null ? null : text(value)
}
function sha(value: unknown): string {
    const result = text(value)
    if (!/^[0-9a-f]{40}$/.test(result)) return fail()
    return result
}
function repository(value: unknown): string {
    return text(record(value).full_name).toLowerCase()
}
function parseRun(value: unknown): ReleaseCiRun {
    const run = record(value)
    return {
        id: integer(run.id),
        number: integer(run.run_number),
        attempt: integer(run.run_attempt),
        workflowId: integer(run.workflow_id),
        path: text(run.path),
        repository: repository(run.repository),
        headRepository: run.head_repository === null ? null : repository(run.head_repository),
        sha: sha(run.head_sha),
        branch: nullableText(run.head_branch),
        event: text(run.event),
        status: text(run.status),
        conclusion: nullableText(run.conclusion),
    }
}
function parseJob(value: unknown): ReleaseCiJob {
    const job = record(value)
    return {
        id: integer(job.id),
        runId: integer(job.run_id),
        sha: sha(job.head_sha),
        name: text(job.name),
        status: text(job.status),
        conclusion: nullableText(job.conclusion),
    }
}

async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    let listener: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
        listener = () => reject(new Error(CI_GATE_ERROR))
        signal.addEventListener('abort', listener, { once: true })
    })
    try {
        const result = await Promise.race([Promise.resolve().then(operation), aborted])
        signal.throwIfAborted()
        return result
    } finally {
        if (listener) signal.removeEventListener('abort', listener)
    }
}

export function createCiGetJson(token: string, fetcher: typeof fetch = fetch): CiGetJson {
    if (!token || token.length > 16_384 || /[\r\n\0]/.test(token)) return fail()
    return async (path, signal) => {
        let response: Response | undefined
        try {
            if (
                !path.startsWith(`${API_PATH}/`) ||
                !/^[/a-zA-Z0-9?=&._-]+$/.test(path) ||
                path.includes('..')
            )
                return fail()
            const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
            response = await abortable(
                () =>
                    fetcher(`https://api.github.com${path}`, {
                        headers: {
                            Accept: 'application/vnd.github+json',
                            Authorization: `Bearer ${token}`,
                            'X-GitHub-Api-Version': '2026-03-10',
                        },
                        redirect: 'error',
                        signal: deadline,
                    }),
                deadline,
            )
            if (
                response.status !== 200 ||
                response.redirected ||
                !['application/json', 'application/vnd.github+json'].includes(
                    response.headers.get('content-type')?.split(';')[0]?.trim() ?? '',
                ) ||
                !response.body
            )
                return fail()
            const bytes = await readBoundedStream(response.body, MAX_CI_RESPONSE_BYTES, deadline)
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
        } catch {
            return fail()
        } finally {
            void response?.body?.cancel().catch(() => undefined)
        }
    }
}

async function pages<T extends { readonly id: number }>(
    get: (path: string) => Promise<unknown>,
    path: string,
    key: string,
    parse: (value: unknown) => T,
): Promise<T[]> {
    const result: T[] = []
    const seen = new Set<number>()
    let expected: number | undefined
    for (let page = 1; page <= MAX_PAGES; page++) {
        const response = record(
            // oxlint-disable-next-line no-await-in-loop -- Each page must be validated before requesting the next.
            await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`),
        )
        const total = integer(response.total_count, 0)
        // At the API's search ceiling completeness cannot be established safely.
        if (total >= MAX_ITEMS || (expected !== undefined && total !== expected)) return fail()
        expected = total
        const values = response[key]
        if (!Array.isArray(values) || values.length > 100) return fail()
        for (const value of values) {
            const item = parse(value)
            if (seen.has(item.id)) return fail()
            seen.add(item.id)
            result.push(item)
        }
        if (result.length > total) return fail()
        if (result.length === total) return result
        if (values.length < 100) return fail()
    }
    return fail()
}

function latest(
    runs: readonly ReleaseCiRun[],
    workflowId: number,
    workflowPath: string,
    revision: string,
): ReleaseCiRun {
    const trusted = runs.filter(
        (run) =>
            run.workflowId === workflowId &&
            run.path === workflowPath &&
            run.repository === REPOSITORY &&
            run.headRepository === REPOSITORY &&
            run.sha === revision &&
            run.branch === 'main' &&
            ['push', 'workflow_dispatch'].includes(run.event),
    )
    const numbers = new Set(trusted.map((run) => run.number))
    if (numbers.size !== trusted.length) return fail()
    const candidate = trusted.toSorted((a, b) => b.number - a.number)[0]
    if (!candidate) return fail()
    return candidate
}
function successful(run: ReleaseCiRun): void {
    if (run.status !== 'completed' || run.conclusion !== 'success') fail()
}
function unchanged(before: ReleaseCiRun, after: ReleaseCiRun): void {
    if (JSON.stringify(before) !== JSON.stringify(after)) fail()
    successful(after)
}

async function verifyWorkflow(
    get: (path: string) => Promise<unknown>,
    revision: string,
    filename: string,
    requiredJobs: readonly string[],
): Promise<() => Promise<void>> {
    const workflowPath = `.github/workflows/${filename}`
    const workflow = record(await get(`${API_PATH}/workflows/${filename}`))
    const workflowId = integer(workflow.id)
    if (workflow.path !== workflowPath || workflow.state !== 'active') return fail()
    const runPath = `${API_PATH}/workflows/${workflowId}/runs?head_sha=${revision}&branch=main`
    const candidate = latest(
        await pages(get, runPath, 'workflow_runs', parseRun),
        workflowId,
        workflowPath,
        revision,
    )
    successful(candidate)
    unchanged(candidate, parseRun(await get(`${API_PATH}/runs/${candidate.id}`)))
    // The attempt-specific endpoint is the fence; job.run_attempt is not a documented required field.
    const jobs = await pages(
        get,
        `${API_PATH}/runs/${candidate.id}/attempts/${candidate.attempt}/jobs`,
        'jobs',
        parseJob,
    )
    if (jobs.some((job) => job.runId !== candidate.id || job.sha !== revision)) return fail()
    for (const name of requiredJobs) {
        const matching = jobs.filter((job) => job.name === name)
        if (
            matching.length !== 1 ||
            matching[0]?.status !== 'completed' ||
            matching[0]?.conclusion !== 'success'
        )
            return fail()
    }
    return async () => {
        unchanged(
            candidate,
            latest(
                await pages(get, runPath, 'workflow_runs', parseRun),
                workflowId,
                workflowPath,
                revision,
            ),
        )
        unchanged(candidate, parseRun(await get(`${API_PATH}/runs/${candidate.id}`)))
    }
}

export async function verifyExactRevisionCi(
    repositoryName: string,
    revision: string,
    getJson: CiGetJson,
    signal = AbortSignal.timeout(60_000),
): Promise<void> {
    try {
        if (repositoryName.toLowerCase() !== REPOSITORY) return fail()
        sha(revision)
        const get = (path: string) => abortable(() => getJson(path, signal), signal)
        const rechecks: (() => Promise<void>)[] = []
        for (const required of REQUIRED_WORKFLOWS) {
            // oxlint-disable-next-line no-await-in-loop -- Verify each workflow under the shared deadline.
            rechecks.push(await verifyWorkflow(get, revision, required.filename, required.jobs))
        }
        for (const recheck of rechecks) {
            // oxlint-disable-next-line no-await-in-loop -- Recheck all selected workflows after all jobs were verified.
            await recheck()
        }
    } catch {
        return fail()
    }
}

if (import.meta.main) {
    try {
        await verifyExactRevisionCi(
            process.env.GITHUB_REPOSITORY ?? '',
            process.env.RELEASE_REVISION ?? '',
            createCiGetJson(process.env.GH_TOKEN ?? ''),
        )
    } catch {
        console.error(`::error::${CI_GATE_ERROR}`)
        process.exitCode = 1
    }
}
