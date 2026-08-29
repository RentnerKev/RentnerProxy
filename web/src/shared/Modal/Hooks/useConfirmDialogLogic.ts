interface UseConfirmDialogLogicParams {
    readonly isPending: boolean
    readonly onConfirm: () => void | Promise<void>
}

export default function useConfirmDialogLogic({
    isPending,
    onConfirm,
}: UseConfirmDialogLogicParams) {
    return {
        handleConfirm: () => {
            if (!isPending) {
                void onConfirm()
            }
        },
    }
}
