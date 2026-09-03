import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

const repositoryRoot = resolve(import.meta.dir, '../../..')

async function repositoryFile(path: string): Promise<string> {
    return readFile(resolve(repositoryRoot, path), 'utf8')
}

function externalActionReferences(source: string): readonly string[] {
    return [...source.matchAll(/^\s*uses:\s+([^\s]+)(?:\s+#.*)?$/gmu)]
        .map((match) => match[1])
        .filter((reference): reference is string => reference !== undefined)
}

describe('PR labeler governance', () => {
    test('uses a metadata-only pull_request_target workflow with minimal permissions', async () => {
        const workflow = await repositoryFile('.github/workflows/pr-labeler.yml')

        expect(workflow).toContain('name: PR Labeler')
        expect(workflow).toContain('pull_request_target:')
        expect(workflow).not.toMatch(/^\s+pull_request:\s*$/mu)
        expect(workflow).toContain('- opened')
        expect(workflow).toContain('- synchronize')
        expect(workflow).toContain('- reopened')
        expect(workflow).not.toContain('- labeled')
        expect(workflow).toContain('permissions: {}')
        expect(workflow).toContain('contents: read')
        expect(workflow).toContain('pull-requests: write')
        expect(workflow).not.toContain('issues: write')
        expect(workflow).not.toContain('contents: write')
        expect(workflow).not.toContain('packages: write')
        expect(workflow).not.toContain('secrets.')
        expect(workflow).not.toContain('actions/checkout@')
        expect(workflow).not.toMatch(/^\s+run:/mu)
        expect(workflow).not.toContain('github.event.pull_request.head')
        expect(workflow).toContain('sync-labels: false')

        expect(externalActionReferences(workflow)).toEqual([
            'actions/labeler@bf12e9b00b37c5c0ca2b87b79b2daf7891dbda13',
        ])
    })

    test('keeps path labels separate from duplicate triage ownership', async () => {
        const configuration = await repositoryFile('.github/labeler.yml')
        const configuredLabels = [
            'area: auth',
            'area: proxy',
            'area: runtime',
            'area: certificates',
            'area: database',
            'area: ui',
            'area: docker',
            'area: ci',
            'documentation',
        ]

        for (const label of configuredLabels) {
            const key = label.includes(':') ? `'${label}':` : `${label}:`
            expect(configuration).toContain(key)
        }
        for (const label of [
            'possible-duplicate',
            'related',
            'duplicate',
            'no-triage',
            'skip-automation',
            'no-duplicate-check',
        ]) {
            expect(configuration).not.toMatch(new RegExp(`^['"]?${label}['"]?:`, 'mu'))
        }
    })
})
