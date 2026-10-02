import type { ConfirmDialogLogicResult, UseConfirmDialogLogicParams } from '../Types/modal.types.ts'

export default function useConfirmDialogLogic({
    isPending,
    onConfirm,
}: UseConfirmDialogLogicParams): ConfirmDialogLogicResult {
    return {
        handler: {
            handleConfirm: () => {
                if (!isPending) {
                    void onConfirm()
                }
            },
        },
    }
}
