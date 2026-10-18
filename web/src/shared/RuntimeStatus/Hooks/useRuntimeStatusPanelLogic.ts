import type {
    RuntimeStatusPanelProps,
    RuntimeStatusPanelLogicResult,
} from '../Types/runtime-status.types.ts'
export default function useRuntimeStatusPanelLogic({
    canApply,
    isError = false,
    status,
}: Pick<
    RuntimeStatusPanelProps,
    'canApply' | 'isError' | 'status'
>): RuntimeStatusPanelLogicResult {
    const displayStatus = isError ? undefined : status
    const state = displayStatus?.state ?? 'unavailable'
    const showApply =
        canApply &&
        !isError &&
        displayStatus !== undefined &&
        displayStatus.desiredRevision !== displayStatus.activeRevision

    const hidden =
        (status === undefined && !isError) || (state === 'synced' && !showApply && !isError)

    return { state: { runtimeState: state, showApply, hidden } }
}
