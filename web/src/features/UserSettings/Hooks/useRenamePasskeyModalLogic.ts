import { useState } from 'react'

export default function useRenamePasskeyModalLogic(
    initialName: string,
    onConfirm: (name: string) => void,
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
        handler: { setName: setNameFromInput, confirm },
    }
}
