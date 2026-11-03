import { createInstrumenter } from '@vitest/istanbul-lib-instrument'
import { basename } from 'node:path'
import { parseSync, transformSync } from 'rolldown/utils'
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
    const lang = filename.endsWith('.tsx') ? 'tsx' : 'ts'
    const parsed = parseSync(filename, source, { sourceType: 'module', lang })
    const parseError = parsed.errors.find((error) => error.severity === 'Error')
    if (parseError) throw new SyntaxError(`${filename}: ${parseError.message}`)
    rejectUnsupportedRuntimeSyntax(parsed.program, filename)
    // The instrumenter's public parser accepts JavaScript/JSX, so strip types
    // with Oxc first and retain its map for reporting against untouched sources.
    const transformed = transformSync(filename, source, {
        lang,
        sourceType: 'module',
        jsx: 'preserve',
        target: 'esnext',
        tsconfig: false,
        sourcemap: true,
    })
    if (transformed.errors.length > 0) throw transformed.errors[0]
    if (!transformed.map) throw new Error(`Coverage source map missing: ${filename}`)
    // Source-map names resolve relative to the generated file, not the repo root.
    const inputSourceMap = {
        ...transformed.map,
        version: 3 as const,
        sources: [basename(filename)],
    }
    const instrumenter = createInstrumenter({
        esModules: true,
        coverageVariable: 'rentnerproxyCoverage',
        coverageGlobalScope: 'globalThis',
        coverageGlobalScopeFunc: false,
        inputSourceMap: false,
    })
    const code = instrumenter.instrumentSync(transformed.code, filename, inputSourceMap)
    return { code, coverage: instrumenter.lastFileCoverage(), sourceMap: inputSourceMap }
}
