import { expect, test } from 'bun:test'
import {
    CI_GATE_ERROR,
    createCiGetJson,
    MAX_CI_RESPONSE_BYTES,
    REQUIRED_CI_JOBS,
    REQUIRED_COMPATIBILITY_JOBS,
    verifyExactRevisionCi,
} from '../../../../../.github/scripts/release/verify-exact-revision-ci.ts'
import type { CiGetJson } from '../../../../../.github/scripts/release/Types/exact-revision-ci.types.ts'

const revision = 'a'.repeat(40)
const repository = 'RentnerKev/RentnerProxy'
const prefix = '/repos/rentnerkev/rentnerproxy/actions'
function run(overrides: Record<string, unknown> = {}) {
    return {
        id: 20,
        run_number: 2,
        run_attempt: 3,
        workflow_id: 10,
        path: '.github/workflows/ci.yml',
        repository: { full_name: repository },
        head_repository: { full_name: repository },
        head_sha: revision,
        head_branch: 'main',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        ...overrides,
    }
}
function job(name: string, id: number, overrides: Record<string, unknown> = {}) {
    return {
        id,
        run_id: 20,
        head_sha: revision,
        name,
        status: 'completed',
        conclusion: 'success',
        ...overrides,
    }
}
function fixture() {
    const compatibility = {
        runs: [
            run({ id: 40, workflow_id: 30, path: '.github/workflows/release-compatibility.yml' }),
        ],
        finalRuns: null as ReturnType<typeof run>[] | null,
        details: [] as ReturnType<typeof run>[],
        jobs: REQUIRED_COMPATIBILITY_JOBS.map((name, index) =>
            job(name, index + 1, { run_id: 40 }),
        ),
        workflow: { id: 30, path: '.github/workflows/release-compatibility.yml', state: 'active' },
    }
    const state = {
        runs: [run()],
        finalRuns: null as ReturnType<typeof run>[] | null,
        jobs: REQUIRED_CI_JOBS.map((name, index) => job(name, index + 1)),
        details: [] as ReturnType<typeof run>[],
        workflow: { id: 10, path: '.github/workflows/ci.yml', state: 'active' },
    }
    const paths: string[] = []
    let listings = 0
    let compatibilityListings = 0
    const getJson: CiGetJson = async (path) => {
        paths.push(path)
        if (path === `${prefix}/workflows/ci.yml`) return state.workflow
        const url = new URL('https://api.github.com' + path)
        const page = Number(url.searchParams.get('page'))
        if (path === `${prefix}/workflows/release-compatibility.yml`) return compatibility.workflow
        if (url.pathname === `${prefix}/workflows/30/runs`) {
            if (page === 1) compatibilityListings++
            const runs =
                compatibilityListings === 1 || !compatibility.finalRuns
                    ? compatibility.runs
                    : compatibility.finalRuns
            return {
                total_count: runs.length,
                workflow_runs: runs.slice((page - 1) * 100, page * 100),
            }
        }
        if (url.pathname === `${prefix}/runs/40`)
            return (
                compatibility.details.shift() ?? compatibility.runs.find((value) => value.id === 40)
            )
        if (url.pathname === `${prefix}/runs/40/attempts/3/jobs`)
            return {
                total_count: compatibility.jobs.length,
                jobs: compatibility.jobs.slice((page - 1) * 100, page * 100),
            }
        if (url.pathname === `${prefix}/workflows/10/runs`) {
            if (page === 1) listings++
            const runs = listings === 1 || !state.finalRuns ? state.runs : state.finalRuns
            return {
                total_count: runs.length,
                workflow_runs: runs.slice((page - 1) * 100, page * 100),
            }
        }
        if (url.pathname === `${prefix}/runs/20`)
            return state.details.shift() ?? state.runs.find((value) => value.id === 20)
        if (url.pathname === `${prefix}/runs/20/attempts/3/jobs`)
            return {
                total_count: state.jobs.length,
                jobs: state.jobs.slice((page - 1) * 100, page * 100),
            }
        throw new Error('Unexpected fixture request')
    }
    return { state, compatibility, paths, getJson }
}

test.each(['push', 'workflow_dispatch'])(
    'accepts a complete trusted main %s run at the exact release SHA',
    async (event) => {
        const data = fixture()
        data.state.runs = [run({ event })]
        await verifyExactRevisionCi(repository, revision, data.getJson)
        expect(data.paths.slice(0, 4)).toEqual([
            `${prefix}/workflows/ci.yml`,
            `${prefix}/workflows/10/runs?head_sha=${revision}&branch=main&per_page=100&page=1`,
            `${prefix}/runs/20`,
            `${prefix}/runs/20/attempts/3/jobs?per_page=100&page=1`,
        ])
        expect(data.paths.some((path) => /status=|event=/.test(path))).toBe(false)
    },
)

test.each([
    { repository: { full_name: 'attacker/repository' } },
    { head_repository: { full_name: 'attacker/repository' } },
    { head_repository: null },
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { event: 'pull_request_target' },
    { workflow_id: 99 },
    { path: '.github/workflows/other.yml' },
])('rejects an untrusted CI identity %j', async (overrides) => {
    const data = fixture()
    data.state.runs = [run(overrides)]
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test('ignores unrelated newer runs but chooses the highest trusted run_number, not numeric run ID', async () => {
    const data = fixture()
    data.state.runs.push(
        run({ id: 900, run_number: 1, conclusion: 'failure' }),
        run({ id: 901, run_number: 10, event: 'pull_request' }),
    )
    await verifyExactRevisionCi(repository, revision, data.getJson)
})

test.each(['queued', 'in_progress', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out'])(
    'does not fall back to older success when the latest run is %s',
    async (state) => {
        const data = fixture()
        data.state.runs = [
            run({ id: 19, run_number: 1 }),
            run({
                status: state === 'queued' || state === 'in_progress' ? state : 'completed',
                conclusion: state === 'queued' || state === 'in_progress' ? null : state,
            }),
        ]
        await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
            CI_GATE_ERROR,
        )
    },
)

test.each([
    { id: 21 },
    { run_number: 3 },
    { run_attempt: 4 },
    { workflow_id: 11 },
    { path: 'other' },
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'other' },
    { event: 'pull_request' },
    { repository: { full_name: 'other/repo' } },
    { head_repository: null },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
])('rejects details or final attempt changes %j', async (changed) => {
    const initial = fixture()
    initial.state.details = [run(changed)]
    await expect(verifyExactRevisionCi(repository, revision, initial.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
    const final = fixture()
    final.state.details = [run(), run(changed)]
    await expect(verifyExactRevisionCi(repository, revision, final.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test('rejects a newer trusted run appearing after job verification', async () => {
    const data = fixture()
    data.state.finalRuns = [run(), run({ id: 21, run_number: 3 })]
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test.each(REQUIRED_CI_JOBS)(
    'blocks a partial rerun missing %s instead of borrowing an older attempt',
    async (name) => {
        const data = fixture()
        data.state.jobs = data.state.jobs.filter((value) => value.name !== name)
        await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
            CI_GATE_ERROR,
        )
        expect(data.paths.some((path) => path.includes('/attempts/3/jobs'))).toBe(true)
        expect(data.paths.some((path) => /attempts\/[12]\/|filter=all/.test(path))).toBe(false)
    },
)

test.each([
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'skipped' },
    { conclusion: 'neutral' },
    { run_id: 21 },
    { head_sha: 'b'.repeat(40) },
])('rejects invalid required jobs %j', async (changed) => {
    const data = fixture()
    data.state.jobs[0] = job('Format', 1, changed)
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test('rejects duplicate required names and ambiguous run numbers', async () => {
    const data = fixture()
    data.state.jobs.push(job('Format', 99))
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
    const runs = fixture()
    runs.state.runs.push(run({ id: 21 }))
    await expect(verifyExactRevisionCi(repository, revision, runs.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test('paginates all runs and attempt jobs before success, and repeats the complete run scan', async () => {
    const data = fixture()
    data.state.runs = [
        ...Array.from({ length: 200 }, (_, index) =>
            run({ id: 100 + index, run_number: 100 + index, event: 'pull_request' }),
        ),
        run(),
    ]
    data.state.jobs.unshift(
        ...Array.from({ length: 200 }, (_, index) => job('optional-' + index, 100 + index)),
    )
    await verifyExactRevisionCi(repository, revision, data.getJson)
    expect(data.paths.filter((path) => path.includes('/workflows/10/runs?')).length).toBe(6)
    expect(data.paths.filter((path) => path.includes('/runs/20/attempts/3/jobs?')).length).toBe(3)
})

test.each([
    { id: 0 },
    { run_number: 0 },
    { run_attempt: '3' },
    { workflow_id: null },
    { repository: [] },
    { head_repository: undefined },
    { head_sha: 'a'.repeat(39) },
    { status: undefined },
    { conclusion: undefined },
    { id: Number.MAX_SAFE_INTEGER + 1 },
])('fails closed on malformed run data %j', async (changed) => {
    const data = fixture()
    data.state.runs = [run(changed)]
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test.each([
    { total_count: 1_000, workflow_runs: [] },
    { total_count: -1, workflow_runs: [] },
    { total_count: 1, workflow_runs: [] },
    { total_count: '1', workflow_runs: [run()] },
    { total_count: 1, workflow_runs: {} },
    { total_count: 2, workflow_runs: [run(), run()] },
])('rejects truncated, duplicate or malformed pagination %j', async (page) => {
    const data = fixture()
    const getJson: CiGetJson = (path, signal) =>
        path.includes('/workflows/10/runs?') ? Promise.resolve(page) : data.getJson(path, signal)
    await expect(verifyExactRevisionCi(repository, revision, getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test('rejects changing page totals without falling back to a partial result', async () => {
    const data = fixture()
    data.state.runs = Array.from({ length: 101 }, (_, index) =>
        run({ id: 100 + index, run_number: index + 1 }),
    )
    const getJson: CiGetJson = (path, signal) =>
        path.includes('page=2')
            ? Promise.resolve({ total_count: 102, workflow_runs: [run()] })
            : data.getJson(path, signal)
    await expect(verifyExactRevisionCi(repository, revision, getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test.each([{ path: 'wrong' }, { id: 0 }, { state: 'disabled_manually' }])(
    'rejects an unbound workflow %j',
    async (changed) => {
        const data = fixture()
        Object.assign(data.state.workflow, changed)
        await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
            CI_GATE_ERROR,
        )
    },
)

test('rejects a wrong repository or short SHA before reading the API', async () => {
    const data = fixture()
    await expect(verifyExactRevisionCi('attacker/repo', revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
    await expect(verifyExactRevisionCi(repository, 'aaaaaaa', data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
    expect(data.paths).toEqual([])
})

test('deadline bounds even an injected API that ignores cancellation', async () => {
    await expect(
        verifyExactRevisionCi(
            repository,
            revision,
            () => new Promise(() => {}),
            AbortSignal.timeout(10),
        ),
    ).rejects.toThrow(CI_GATE_ERROR)
}, 1_000)

test('sanitizes injected API exceptions', async () => {
    await expect(
        verifyExactRevisionCi(repository, revision, async () => {
            throw new Error('SECRET BODY OR TOKEN')
        }),
    ).rejects.toThrow(/^Exact release revision CI verification failed\.$/)
})

function fetchResponse(factory: () => Response | Promise<Response>): typeof fetch {
    return Object.assign(async (..._args: Parameters<typeof fetch>) => factory(), {
        preconnect: fetch.preconnect,
    })
}

test('production HTTP client uses the fixed API, environment-supplied token and current API version', async () => {
    let observed: Parameters<typeof fetch> | undefined
    const fetcher = Object.assign(
        async (...args: Parameters<typeof fetch>) => {
            observed = args
            return Response.json({ id: 10 })
        },
        { preconnect: fetch.preconnect },
    )
    expect(
        await createCiGetJson('fixture-token', fetcher)(
            `${prefix}/workflows/ci.yml`,
            new AbortController().signal,
        ),
    ).toEqual({ id: 10 })
    expect(observed?.[0]).toBe('https://api.github.com' + prefix + '/workflows/ci.yml')
    expect(observed?.[1]).toMatchObject({
        redirect: 'error',
        headers: { Authorization: 'Bearer fixture-token', 'X-GitHub-Api-Version': '2026-03-10' },
    })
})

test.each([301, 302, 401, 403, 404, 429, 500])('HTTP %s is a sanitized failure', async (status) => {
    const get = createCiGetJson(
        'fixture-token',
        fetchResponse(() => new Response('SECRET', { status })),
    )
    await expect(get(`${prefix}/workflows/ci.yml`, new AbortController().signal)).rejects.toThrow(
        new Error(CI_GATE_ERROR),
    )
})

test.each([
    'malformed-json',
    'invalid-utf8',
    'oversized',
    'read-error',
    'wrong-content-type',
    'no-body',
])(
    'bounds and rejects %s API bodies',
    async (mode) => {
        const response = () => {
            const headers = { 'content-type': 'application/json' }
            if (mode === 'invalid-utf8') return new Response(Uint8Array.of(255), { headers })
            if (mode === 'oversized')
                return new Response(
                    new ReadableStream({
                        start: (controller) =>
                            controller.enqueue(new Uint8Array(MAX_CI_RESPONSE_BYTES + 1)),
                        cancel: () => new Promise<void>(() => {}),
                    }),
                    { headers },
                )
            if (mode === 'read-error')
                return new Response(
                    new ReadableStream({
                        start: (controller) => controller.error(new Error('SECRET')),
                    }),
                    { headers },
                )
            if (mode === 'wrong-content-type') return new Response('{}')
            if (mode === 'no-body') return new Response(null, { headers })
            return new Response('{SECRET', { headers })
        }
        await expect(
            createCiGetJson('fixture-token', fetchResponse(response))(
                `${prefix}/workflows/ci.yml`,
                new AbortController().signal,
            ),
        ).rejects.toThrow(new Error(CI_GATE_ERROR))
    },
    1_000,
)

test.each(['fetch', 'body'])(
    'request cancellation bounds a hanging %s',
    async (mode) => {
        let body: ReadableStream<Uint8Array> | undefined
        const get = createCiGetJson(
            'fixture-token',
            fetchResponse(() => {
                if (mode === 'fetch') return new Promise<Response>(() => {})
                body = new ReadableStream({ cancel: () => new Promise<void>(() => {}) })
                return new Response(body, { headers: { 'content-type': 'application/json' } })
            }),
        )
        await expect(get(`${prefix}/workflows/ci.yml`, AbortSignal.timeout(10))).rejects.toThrow(
            new Error(CI_GATE_ERROR),
        )
        if (body) expect(body.locked).toBe(false)
    },
    1_000,
)

test.each(['missing', 'skipped', 'failure', 'partial', 'duplicate', 'wrong-sha', 'wrong-run'])(
    'rejects compatibility aggregate %s',
    async (mode) => {
        const data = fixture()
        if (mode === 'missing' || mode === 'partial')
            data.compatibility.jobs = [job('Upgrade old beta', 50, { run_id: 40 })]
        if (mode === 'skipped' || mode === 'failure') data.compatibility.jobs[0]!.conclusion = mode
        if (mode === 'duplicate')
            data.compatibility.jobs.push(job('Compatibility verified', 51, { run_id: 40 }))
        if (mode === 'wrong-sha') data.compatibility.jobs[0]!.head_sha = 'b'.repeat(40)
        if (mode === 'wrong-run') data.compatibility.jobs[0]!.run_id = 20
        await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
            CI_GATE_ERROR,
        )
    },
)

test.each([
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { head_repository: null },
    { repository: { full_name: 'attacker/repo' } },
    { head_sha: 'b'.repeat(40) },
    { workflow_id: 99 },
    { path: '.github/workflows/ci.yml' },
    { status: 'in_progress', conclusion: null },
    { conclusion: 'failure' },
])('rejects untrusted or incomplete compatibility run %j', async (changed) => {
    const data = fixture()
    Object.assign(data.compatibility.runs[0]!, changed)
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test('rejects missing compatibility workflow runs', async () => {
    const data = fixture()
    data.compatibility.runs = []
    await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})

test.each(['latest-failed', 'new-run', 'rerun', 'detail-rerun'])(
    'fences compatibility %s without falling back to old success',
    async (mode) => {
        const data = fixture()
        const newer = {
            ...data.compatibility.runs[0]!,
            id: 41,
            run_number: 3,
            conclusion: 'failure',
        }
        if (mode === 'latest-failed') data.compatibility.runs.push(newer)
        if (mode === 'new-run') data.compatibility.finalRuns = [...data.compatibility.runs, newer]
        if (mode === 'rerun')
            data.compatibility.finalRuns = [{ ...data.compatibility.runs[0]!, run_attempt: 4 }]
        if (mode === 'detail-rerun')
            data.compatibility.details = [
                data.compatibility.runs[0]!,
                { ...data.compatibility.runs[0]!, run_attempt: 4 },
            ]
        await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
            CI_GATE_ERROR,
        )
    },
)

test('paginates compatibility runs and jobs completely and rescans after both workflows', async () => {
    const data = fixture()
    const compatible = data.compatibility.runs[0]!
    data.compatibility.runs.unshift(
        ...Array.from({ length: 200 }, (_, index) => ({
            ...compatible,
            id: 100 + index,
            run_number: 100 + index,
            event: 'pull_request',
        })),
    )
    data.compatibility.jobs.unshift(
        ...Array.from({ length: 200 }, (_, index) =>
            job(`optional-${index}`, 100 + index, { run_id: 40 }),
        ),
    )
    await verifyExactRevisionCi(repository, revision, data.getJson)
    expect(data.paths.filter((path) => path.includes('/workflows/30/runs?')).length).toBe(6)
    expect(data.paths.filter((path) => path.includes('/runs/40/attempts/3/jobs?')).length).toBe(3)
    expect(data.paths.lastIndexOf(`${prefix}/runs/20`)).toBeGreaterThan(
        data.paths.indexOf(`${prefix}/runs/40/attempts/3/jobs?per_page=100&page=3`),
    )
})

test.each([{ path: '.github/workflows/ci.yml' }, { state: 'disabled_manually' }, { id: 0 }])(
    'rejects an unbound compatibility workflow %j',
    async (changed) => {
        const data = fixture()
        Object.assign(data.compatibility.workflow, changed)
        await expect(verifyExactRevisionCi(repository, revision, data.getJson)).rejects.toThrow(
            CI_GATE_ERROR,
        )
    },
)

test.each(['runs', 'jobs'])('rejects incomplete compatibility %s listings', async (mode) => {
    const data = fixture()
    const getJson: CiGetJson = (path, signal) =>
        (
            mode === 'runs'
                ? path.includes('/workflows/30/runs?')
                : path.includes('/runs/40/attempts/3/jobs?')
        )
            ? Promise.resolve(
                  mode === 'runs'
                      ? { total_count: 2, workflow_runs: data.compatibility.runs }
                      : { total_count: 2, jobs: data.compatibility.jobs },
              )
            : data.getJson(path, signal)
    await expect(verifyExactRevisionCi(repository, revision, getJson)).rejects.toThrow(
        CI_GATE_ERROR,
    )
})
