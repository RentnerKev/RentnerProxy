import { parse } from '@babel/parser'
import { createInstrumenter } from 'istanbul-lib-instrument'
import type { InstrumentedCoverageSource } from './Types/instrumentation.types.ts'

function rejectUnsupportedRuntimeSyntax(node: unknown, filename: string): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
        for (const child of node) rejectUnsupportedRuntimeSyntax(child, filename)
        return
    }
    const record = node as Record<string, unknown>
    if (
        (record.type === 'TSEnumDeclaration' || record.type === 'TSModuleDeclaration') &&
        record.declare !== true &&
        record.global !== true &&
        typeof (record.id as Record<string, unknown> | undefined)?.value !== 'string'
    ) {
        throw new Error(
            `Coverage cannot instrument runtime TypeScript enums or namespaces: ${filename}`,
        )
    }
    // Ambient declarations and their descendants have no executable source.
    if (record.declare === true) return
    for (const [key, child] of Object.entries(record)) {
        if (
            !['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(
                key,
            )
        ) {
            rejectUnsupportedRuntimeSyntax(child, filename)
        }
    }
}

export function instrumentCoverageSource(
    source: string,
    filename: string,
): InstrumentedCoverageSource {
    rejectUnsupportedRuntimeSyntax(
        parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }),
        filename,
    )
    const instrumenter = createInstrumenter({
        esModules: true,
        coverageVariable: 'rentnerproxyCoverage',
        parserPlugins: ['typescript', 'jsx'],
        coverageGlobalScope: 'globalThis',
        coverageGlobalScopeFunc: false,
        preserveComments: true,
    })
    const code = instrumenter.instrumentSync(source, filename)
    return { code, coverage: instrumenter.lastFileCoverage() }
}
