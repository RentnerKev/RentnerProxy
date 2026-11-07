import type { GitHubRequest } from './Types/pr-maintenance.types.ts'

export class GitHubRequestError extends Error {
    constructor(readonly status: number) {
        super(`GitHub API returned HTTP ${status}`)
    }
}

export function repositoryName(value: string): string {
    if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error('Invalid GitHub repository')
    return value.toLowerCase()
}

export function createGitHubRequest(repository: string, token: string): GitHubRequest {
    const prefix = `/repos/${repositoryName(repository)}/`
    if (!token.trim()) throw new Error('Missing GitHub App token')
    return async (method, path, body) => {
        if (path !== '/graphql' && !path.startsWith(prefix)) {
            throw new Error('GitHub request outside the configured repository')
        }
        const response = await fetch(`https://api.github.com${path}`, {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new GitHubRequestError(response.status)
        return response.json() as Promise<unknown>
    }
}

export function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid GitHub API object')
    }
    return value as Record<string, unknown>
}

export function commitSha(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
        throw new Error('Invalid GitHub commit SHA')
    }
    return value
}

export async function arrayPages(request: GitHubRequest, path: string): Promise<unknown[]> {
    const result: unknown[] = []
    for (let page = 1; page <= 30; page += 1) {
        const separator = path.includes('?') ? '&' : '?'
        // eslint-disable-next-line no-await-in-loop -- pagination terminates on the first short page
        const entries = await request('GET', `${path}${separator}per_page=100&page=${page}`)
        if (!Array.isArray(entries)) throw new Error('Invalid GitHub API page')
        result.push(...entries)
        if (entries.length < 100) return result
    }
    throw new Error('GitHub API pagination limit exceeded')
}
