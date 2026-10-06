import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../../..')

export default async function readGitHubWorkflow(name: string): Promise<string> {
    let source = (
        await readFile(resolve(repositoryRoot, '.github/workflows', name), 'utf8')
    ).replaceAll('\r\n', '\n')
    const calls = [
        ...source.matchAll(
            /^( +)run: bash (?:(?:trusted|source|automation)\/)?(\.github\/scripts\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.sh) *$/gmu,
        ),
    ]
    const scripts = await Promise.all(
        calls.map(async (call) => ({
            call: call[0],
            indent: call[1],
            source: (await readFile(resolve(repositoryRoot, call[2]!), 'utf8')).trimEnd(),
        })),
    )
    for (const script of scripts) {
        source = source.replace(
            script.call,
            () =>
                `${script.indent}run: |\n${script.source
                    .replaceAll('\r\n', '\n')
                    .split('\n')
                    .map((line) => `${script.indent}    ${line}`)
                    .join('\n')}`,
        )
    }
    return source
}
