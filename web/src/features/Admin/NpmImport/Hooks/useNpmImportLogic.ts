import type { NpmImportLogicResult } from '../Types/npm-import-logic.types.ts'
import { useImportWorkflow } from '@/shared/Imports/Hooks/useImportWorkflow.ts'

export function useNpmImportLogic(): NpmImportLogicResult {
    const { state, handler } = useImportWorkflow({
        endpoint: '/api/npm-import',
        errorNamespace: 'npmImport',
        importHeader: 'sqlite',
        maxFileBytes: 32 * 1024 * 1024,
    })
    return { state, handler }
}
