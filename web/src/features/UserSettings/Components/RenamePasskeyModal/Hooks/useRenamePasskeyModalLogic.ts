import type { RenamePasskeyModalLogicResult } from '../Types/rename-passkey-modal.types.ts'
import { useState } from 'react'

export default function useRenamePasskeyModalLogic(
    initialName: string,
    onConfirm: (name: string) => void,
    onClose: () => void,
    isPending: boolean,
) {
    const [draft, setDraft] = useState<string | null>(null)
    const name = draft ?? initialName

    const setNameFromInput = (value: string) => {
        setDraft(value.slice(0, 100))
    }
    const confirm = () => {
        const trimmed = name.trim()
        if (trimmed) onConfirm(trimmed)
    }
    return {
        state: { name, canSubmit: Boolean(name.trim()) },
        handler: {
            handleOpenChange: (open) => {
                if (!open && !isPending) onClose()
            },
            setName: setNameFromInput,
            confirm,
        },
    } satisfies RenamePasskeyModalLogicResult
}
